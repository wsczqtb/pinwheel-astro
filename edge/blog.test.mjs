import assert from "node:assert/strict";
import test from "node:test";
import worker, { handleRequest } from "./blog.js";

test("renders an OSS article", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      `---\ntitle: 测试文章\ndescription: 测试摘要\ndate: 2026-09-22\nauthor: 编辑\ncategories:\n  - industry-news\n---\n\n## 正文`,
    );
  try {
    const response = await handleRequest(
      new Request("https://example.com/blog/zy-space-page"),
      { OSS_PUBLIC_URL: "https://cdn.example.com" },
    );
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /测试文章/);
    assert.match(html, /<h2>正文<\/h2>/);
    assert.match(html, /https:\/\/example\.com\/blog\/zy-space-page/);
    assert.doesNotMatch(html, /%%BLOG_/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("returns an empty successful response to HEAD", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("---\ntitle: 测试文章\n---\n\n正文");
  try {
    const response = await handleRequest(
      new Request("https://example.com/blog/zy-space-page", { method: "HEAD" }),
      { OSS_PUBLIC_URL: "https://cdn.example.com" },
    );
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reports missing runtime configuration", async () => {
  const response = await handleRequest(
    new Request("https://example.com/blog/zy-space-page"),
    {},
  );
  assert.equal(response.status, 500);
});

test("maps an unavailable OSS origin to 502", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("failure", { status: 503 });
  try {
    const response = await handleRequest(
      new Request("https://example.com/blog/zy-space-page"),
      { OSS_PUBLIC_URL: "https://cdn.example.com" },
    );
    assert.equal(response.status, 502);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects non-article paths", async () => {
  const response = await handleRequest(
    new Request("https://example.com/not-an-article"),
    { OSS_PUBLIC_URL: "https://cdn.example.com" },
  );
  assert.equal(response.status, 404);
});

test("routes ZYPlayer publish webhooks to GitHub", async () => {
  const originalFetch = globalThis.fetch;
  let dispatchRequest;
  globalThis.fetch = async (request, options) => {
    dispatchRequest = { request, options };
    return new Response(null, { status: 204 });
  };
  try {
    const response = await worker.fetch(
      new Request("https://example.com/hooks/zyplayer/webhook-secret", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          event: "publish",
          pageId: "page-1",
          spaceId: "space-1",
        }),
      }),
      {},
      {
        WEBHOOK_TOKEN: "webhook-secret",
        GITHUB_DISPATCH_TOKEN: "github-token",
      },
    );

    assert.equal(response.status, 202);
    assert.equal(
      dispatchRequest.request,
      "https://api.github.com/repos/wsczqtb/pinwheel-astro/dispatches",
    );
    assert.equal(
      dispatchRequest.options.headers.authorization,
      "Bearer github-token",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("accepts ZYPlayer publish payloads that use eventType", async () => {
  const originalFetch = globalThis.fetch;
  let dispatched = false;
  globalThis.fetch = async () => {
    dispatched = true;
    return new Response(null, { status: 204 });
  };
  try {
    const response = await worker.fetch(
      new Request("https://example.com/hooks/zyplayer/webhook-secret", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventType: "document_publish",
          pageId: "page-1",
          spaceId: "space-1",
        }),
      }),
      {},
      {
        WEBHOOK_TOKEN: "webhook-secret",
        GITHUB_DISPATCH_TOKEN: "github-token",
      },
    );

    assert.equal(response.status, 202);
    assert.equal(dispatched, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
