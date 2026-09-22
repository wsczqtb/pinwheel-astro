const REPOSITORY = "wsczqtb/pinwheel-astro";
const EVENT_TYPE = "zyplayer_publish";
const PATH_PREFIX = "/hooks/zyplayer/";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request) {
    const { env } = await import("alibaba:workers");
    const pathname = new URL(request.url).pathname;
    const pathToken = pathname.startsWith(PATH_PREFIX)
      ? pathname.slice(PATH_PREFIX.length)
      : "";

    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    if (!env.WEBHOOK_TOKEN || pathToken !== env.WEBHOOK_TOKEN) {
      return json({ error: "unauthorized" }, 401);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }

    if (payload.event !== "publish") return json({ accepted: false, reason: "ignored_event" }, 202);

    const pageId = payload.pageId ?? payload.page_id;
    const spaceId = payload.spaceId ?? payload.space_id;
    if (!pageId || !spaceId) return json({ error: "missing_page_or_space_id" }, 400);
    if (!env.GITHUB_DISPATCH_TOKEN) return json({ error: "missing_server_config" }, 500);

    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/dispatches`, {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
        "content-type": "application/json",
        "x-github-api-version": "2026-03-10",
      },
      body: JSON.stringify({
        event_type: EVENT_TYPE,
        client_payload: {
          pageId: String(pageId),
          spaceId: String(spaceId),
          pageName: payload.pageName,
          spaceName: payload.spaceName,
          userName: payload.userName,
          eventTime: payload.eventTime,
        },
      }),
    });

    if (!response.ok) {
      console.error("GitHub dispatch failed", response.status);
      return json({ error: "github_dispatch_failed" }, 502);
    }

    return json({ accepted: true }, 202);
  },
};
