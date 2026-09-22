import { load as parseYaml } from "js-yaml";
import { marked } from "marked";
import { handleWebhook } from "../scripts/esa_zyplayer_webhook.js";
import { ARTICLE_TEMPLATE } from "./generated-template.js";

const ARTICLE_PATH = /^\/blog\/([A-Za-z0-9][A-Za-z0-9._-]{0,119})\/?$/;
const CATEGORY_LABELS = {
  "amazon-operation": "亚马逊运营",
  "cross-border": "跨境电商",
  "erp-guide": "ERP教程",
  "industry-news": "行业资讯",
};

const escapeHtml = (value = "") =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );

const replaceToken = (html, name, value) =>
  html.split(`%%BLOG_${name}%%`).join(value);

const parseArticle = (source) => {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { data: {}, content: source };
  return {
    data: parseYaml(match[1]) || {},
    content: source.slice(match[0].length),
  };
};

const notFound = () =>
  new Response(
    '<!doctype html><html lang="zh-CN"><title>页面不存在</title><h1>404</h1><p>页面不存在</p></html>',
    {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    },
  );

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  const match = url.pathname.match(ARTICLE_PATH);
  if (!match) return notFound();
  if (!["GET", "HEAD"].includes(request.method)) {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  }

  const ossBaseUrl = env.OSS_PUBLIC_URL?.replace(/\/$/, "");
  if (!ossBaseUrl) {
    return new Response("Server configuration error", { status: 500 });
  }

  const slug = match[1];
  const sourceUrl = `${ossBaseUrl}/blog/posts/${encodeURIComponent(slug)}.md`;
  let response;
  try {
    response = await fetch(sourceUrl);
  } catch (error) {
    console.error(
      JSON.stringify({ event: "oss_fetch_failed", slug, error: String(error) }),
    );
    return new Response("Article source unavailable", { status: 502 });
  }
  if (response.status === 404) return notFound();
  if (!response.ok) {
    console.error(
      JSON.stringify({
        event: "oss_fetch_failed",
        slug,
        status: response.status,
      }),
    );
    return new Response("Article source unavailable", { status: 502 });
  }

  const { data, content } = parseArticle(await response.text());
  if (!data.title || data.draft === true) return notFound();

  const title = escapeHtml(data.title);
  const description = escapeHtml(data.description || "");
  const author = escapeHtml(data.author || "9810云");
  const date = data.date
    ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" }).format(
        new Date(data.date),
      )
    : "";
  const categories = Array.isArray(data.categories)
    ? data.categories
    : ["others"];
  const categoryHtml = categories
    .map((category) => {
      const value = String(category);
      const label = CATEGORY_LABELS[value] || value;
      return `<a class="hover:text-primary" href="/categories/${encodeURIComponent(value)}">${escapeHtml(label)}</a>`;
    })
    .join(", ");
  const canonical = new URL(`/blog/${slug}`, url.origin).href;
  const image = data.image ? new URL(String(data.image), ossBaseUrl).href : "";
  const contentHtml = await marked.parse(content);
  const imageHtml = image
    ? `<img class="rounded-xl aspect-video object-contain" src="${escapeHtml(image)}" alt="${title}" width="920" height="450">`
    : "";
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: data.title,
    description: data.description || "",
    datePublished: data.date || undefined,
    dateModified: data.date || undefined,
    image: image || undefined,
    author: { "@type": "Person", name: data.author || "9810云" },
    mainEntityOfPage: canonical,
  }).replace(/</g, "\\u003c");

  let html = ARTICLE_TEMPLATE;
  const values = {
    TITLE: title,
    DESCRIPTION: description,
    IMAGE: escapeHtml(image),
    CANONICAL: escapeHtml(canonical),
    JSON_LD: jsonLd,
    IMAGE_HTML: imageHtml,
    AUTHOR: author,
    DATE: escapeHtml(date),
    READING_TIME: `${Math.max(1, Math.ceil(content.replace(/\s/g, "").length / 500))} 分钟阅读`,
    CATEGORIES: categoryHtml,
    CONTENT: contentHtml,
  };
  for (const [name, value] of Object.entries(values))
    html = replaceToken(html, name, value);

  return new Response(request.method === "HEAD" ? null : html, {
    headers: {
      "cache-control":
        "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-content-type-options": "nosniff",
    },
  });
}

export default {
  fetch(request, _context, env) {
    if (new URL(request.url).pathname.startsWith("/hooks/zyplayer/")) {
      return handleWebhook(request, env);
    }
    return handleRequest(request, env);
  },
};
