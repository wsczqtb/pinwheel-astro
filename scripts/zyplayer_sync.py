"""Fetch one published ZYPlayer page and write it as an Astro blog post."""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urlparse

import requests
from Crypto.Hash import SHA256
from Crypto.PublicKey import RSA
from Crypto.Signature import pkcs1_15


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "src" / "data" / "remote-posts.json"
DETAIL_PATH = "/openApi/v1/space/page/detail"
LINK_RE = re.compile(
    r"(?P<prefix>!?\[[^\]]*\]\()(?P<url><https?://[^>]+>|https?://[^)\s]+)(?P<suffix>[^)]*\))"
)
HTML_IMAGE_RE = re.compile(
    r"(?P<prefix><img\b[^>]*?\bsrc=[\"'])(?P<url>https?://[^\"']+)(?P<suffix>[\"'])",
    re.IGNORECASE,
)
FRONTMATTER_RE = re.compile(r"\A---\s*\n.*?\n---\s*\n", re.DOTALL)

CATEGORY_MAP = {
    "亚马逊运营": "amazon-operation",
    "跨境电商": "cross-border",
    "ERP教程": "erp-guide",
    "行业资讯": "industry-news",
}


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def event_payload() -> dict:
    event_path = os.environ.get("GITHUB_EVENT_PATH")
    event = {}
    if event_path and Path(event_path).exists():
        event = json.loads(Path(event_path).read_text(encoding="utf-8"))

    payload = dict(event.get("client_payload") or {})
    for key, value in (event.get("inputs") or {}).items():
        payload.setdefault(key, value)

    page_id = payload.get("pageId") or payload.get("page_id")
    space_id = payload.get("spaceId") or payload.get("space_id") or os.environ.get("ZYPLAYER_SPACE_ID")
    if not page_id or not space_id:
        raise RuntimeError("The dispatch event must include pageId and spaceId")
    return {**payload, "pageId": str(page_id), "spaceId": str(space_id)}


def signed_post(path: str, content: dict) -> dict:
    base_url = required("ZYPLAYER_BASE_URL").rstrip("/")
    api_key = required("ZYPLAYER_API_KEY")
    private_key = required("ZYPLAYER_RSA_PRIVATE_KEY").replace("\\n", "\n")

    request_content = {**content, "salt": hashlib.sha256(os.urandom(32)).hexdigest()}
    content_json = json.dumps(request_content, ensure_ascii=False, separators=(",", ":"))
    key = RSA.import_key(private_key)
    signature = pkcs1_15.new(key).sign(SHA256.new(content_json.encode("utf-8"))).hex()

    response = requests.post(
        f"{base_url}{path}",
        data={"key": api_key, "signature": signature, "content": content_json},
        timeout=30,
    )
    response.raise_for_status()
    body = response.json()
    if body.get("errCode") not in (None, 0, 200, "0", "200"):
        raise RuntimeError(f"ZYPlayer API error: {body}")
    return body


def unwrap_page(body: dict) -> tuple[dict, str]:
    data = body.get("data") or body
    page = data.get("wikiPage") or data.get("page") or data
    content = data.get("content") or page.get("content") or ""
    if isinstance(content, dict):
        content = content.get("markdown") or content.get("content") or ""
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("ZYPlayer detail response did not contain article content")
    return page, content


def safe_name(value: str) -> str:
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip(".-")
    return name[:120] or "asset"


def allowed_asset_hosts() -> set[str]:
    hosts = {urlparse(required("ZYPLAYER_BASE_URL")).hostname or ""}
    extra = os.environ.get("ZYPLAYER_ASSET_HOSTS", "")
    hosts.update(host.strip().lower() for host in extra.split(",") if host.strip())
    return hosts


def oss_enabled() -> bool:
    names = ("OSS_ENDPOINT", "OSS_BUCKET", "OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_SECRET", "OSS_PUBLIC_URL")
    return all(os.environ.get(name, "").strip() for name in names)


def oss_bucket():
    import oss2

    auth = oss2.Auth(required("OSS_ACCESS_KEY_ID"), required("OSS_ACCESS_KEY_SECRET"))
    return oss2.Bucket(auth, required("OSS_ENDPOINT"), required("OSS_BUCKET"))


def public_oss_url(object_key: str) -> str:
    return f"{required('OSS_PUBLIC_URL').rstrip('/')}/{quote(object_key, safe='/')}"


def upload_asset(url: str, page_id: str, space_id: str) -> str | None:
    parsed = urlparse(url)
    if parsed.hostname not in allowed_asset_hosts():
        return None

    response = requests.get(url, stream=True, timeout=30)
    response.raise_for_status()
    content_type = (response.headers.get("content-type") or "application/octet-stream").split(";", 1)[0]
    if content_type.startswith("text/") or content_type in {"text/html", "application/json"}:
        return None

    chunks: list[bytes] = []
    total = 0
    for chunk in response.iter_content(1024 * 1024):
        total += len(chunk)
        if total > 25 * 1024 * 1024:
            raise RuntimeError(f"Asset is larger than 25 MB: {url}")
        chunks.append(chunk)
    data = b"".join(chunks)
    if not data:
        return None

    filename = safe_name(Path(parsed.path).name or "asset")
    digest = hashlib.sha256(data).hexdigest()[:12]
    object_key = f"blog/{space_id}/{page_id}/{digest}-{filename}"

    oss_bucket().put_object(object_key, data, headers={"Content-Type": content_type})
    return public_oss_url(object_key)


def rewrite_assets(markdown: str, page_id: str, space_id: str) -> str:
    if not oss_enabled():
        print("OSS secrets are not complete; keeping original asset URLs.")
        return markdown

    def replace(match: re.Match[str]) -> str:
        raw_url = match.group("url")
        url = raw_url[1:-1] if raw_url.startswith("<") else raw_url
        try:
            replacement = upload_asset(url, page_id, space_id)
        except requests.RequestException as error:
            print(f"Could not download asset {url}: {error}")
            replacement = None
        if not replacement:
            return match.group(0)
        wrapped = f"<{replacement}>" if raw_url.startswith("<") else replacement
        return f"{match.group('prefix')}{wrapped}{match.group('suffix')}"

    markdown = LINK_RE.sub(replace, markdown)

    def replace_html(match: re.Match[str]) -> str:
        try:
            replacement = upload_asset(match.group("url"), page_id, space_id)
        except requests.RequestException as error:
            print(f"Could not download image {match.group('url')}: {error}")
            replacement = None
        if not replacement:
            return match.group(0)
        return f"{match.group('prefix')}{replacement}{match.group('suffix')}"

    return HTML_IMAGE_RE.sub(replace_html, markdown)


def normalize_date(value: object, fallback: str | None = None) -> str:
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc).isoformat()
    if isinstance(value, str) and value.strip():
        return value.strip()
    return fallback or datetime.now(timezone.utc).isoformat()


def categories(page: dict, payload: dict) -> list[str]:
    raw = page.get("categories") or page.get("category") or payload.get("categories") or payload.get("category")
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list):
        raw = []
    result = [CATEGORY_MAP.get(str(item), str(item)) for item in raw if str(item).strip()]
    return result or ["others"]


def description_from(page: dict, content: str) -> str:
    value = page.get("description") or page.get("summary") or page.get("excerpt")
    if isinstance(value, str) and value.strip():
        return " ".join(value.split())[:180]
    plain = re.sub(r"!\[[^]]*\]\([^)]*\)", " ", content)
    plain = re.sub(r"[#>*`_~\[\]()!-]", " ", plain)
    return " ".join(plain.split())[:180]


def yaml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def write_article(page: dict, content: str, payload: dict) -> str:
    if not oss_enabled():
        raise RuntimeError("OSS configuration is required for published articles")

    page_id = payload["pageId"]
    space_id = payload["spaceId"]
    article_id = f"zy-{safe_name(space_id)}-{safe_name(page_id)}"
    title = str(page.get("title") or page.get("pageName") or payload.get("pageName") or f"ZYPlayer文章 {page_id}").strip()
    content = FRONTMATTER_RE.sub("", content).strip()
    content = rewrite_assets(content, page_id, space_id)

    cover = page.get("image") or page.get("cover") or page.get("coverUrl")
    if isinstance(cover, str) and cover.startswith(("http://", "https://")) and oss_enabled():
        cover = upload_asset(cover, page_id, space_id) or cover

    published_at = normalize_date(
        page.get("updateTime") or page.get("publishTime") or page.get("createTime"),
        payload.get("eventTime"),
    )
    article_categories = categories(page, payload)
    author = str(page.get("author") or payload.get("userName") or "9810云")
    lines = ["---", f"title: {yaml_string(title)}"]
    description = description_from(page, content)
    if description:
        lines.append(f"description: {yaml_string(description)}")
    if cover:
        lines.append(f"image: {yaml_string(str(cover))}")
    lines.extend(
        [
            f"author: {yaml_string(author)}",
            f"date: {yaml_string(published_at)}",
            "categories:",
            *[f"  - {yaml_string(item)}" for item in article_categories],
            "featured: false",
            "draft: false",
            "---",
            "",
            content,
            "",
        ]
    )

    object_key = f"blog/posts/{article_id}.md"
    oss_bucket().put_object(
        object_key,
        "\n".join(lines).encode("utf-8"),
        headers={
            "Content-Type": "text/markdown; charset=utf-8",
            "Cache-Control": "public, max-age=300",
        },
    )
    source_url = public_oss_url(object_key)

    posts = json.loads(MANIFEST_PATH.read_text(encoding="utf-8")) if MANIFEST_PATH.exists() else []
    posts = [post for post in posts if post.get("id") != article_id]
    posts.append(
        {
            "id": article_id,
            "data": {
                "title": title,
                "description": description,
                "date": published_at,
                "image": str(cover) if cover else None,
                "author": author,
                "categories": article_categories,
                "featured": False,
            },
            "sourceUrl": source_url,
        }
    )
    posts.sort(key=lambda post: post.get("data", {}).get("date", ""), reverse=True)
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(
        json.dumps(posts, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return source_url


def main() -> int:
    payload = event_payload()
    body = signed_post(
        DETAIL_PATH,
        {"id": payload["pageId"], "spaceId": payload["spaceId"]},
    )
    page, content = unwrap_page(body)
    output = write_article(page, content, payload)
    print(f"Published {output} and updated {MANIFEST_PATH.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ZYPlayer sync failed: {error}", file=sys.stderr)
        raise
