/* oxlint-disable typescript/no-floating-promises */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { mock } from "bun:test";

type FakeObject = {
  httpEtag: string;
  uploaded: Date;
  httpMetadata?: { contentType?: string; cacheControl?: string };
  body: ArrayBuffer;
} | null;

let stored: FakeObject = {
  httpEtag: '"etag-1"',
  uploaded: new Date("2026-10-19T00:00:00Z"),
  httpMetadata: { contentType: "image/png", cacheControl: "public, max-age=60" },
  body: new Uint8Array([137, 80, 78, 71]).buffer,
};
let lastKey: string | null = null;
const requested: string[] = [];

mock.module("@opennextjs/cloudflare", () => ({
  getCloudflareContext: async () => ({
    env: {
      MEDIA: {
        get: async (key: string) => {
          lastKey = key;
          requested.push(key);
          return stored;
        },
      },
    },
    ctx: { waitUntil: () => undefined },
  }),
}));

const { GET } = await import("@/app/media/[...key]/route");

function call(segments: string[], headers?: Record<string, string>) {
  const url = `https://atlas.sololeveling.top/media/${segments.join("/")}`;
  return GET(new Request(url, { headers }), { params: Promise.resolve({ key: segments }) });
}

after(() => {
  mock.restore();
});

describe("GET /media/[...key]", () => {
  test("白名单图片：200 + inline + ETag + nosniff", async () => {
    const response = await call(["places", "p1", "a.png"]);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "image/png");
    assert.equal(response.headers.get("Content-Disposition"), "inline");
    assert.equal(response.headers.get("ETag"), '"etag-1"');
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=60");
    assert.equal(lastKey, "places/p1/a.png");
  });

  test("posts/ 前缀可用（社区帖子图片）", async () => {
    const response = await call(["posts", "post-1", "b.webp"]);
    assert.equal(response.status, 200);
    assert.equal(lastKey, "posts/post-1/b.webp");
  });

  test("If-None-Match 命中 → 304 且无响应体", async () => {
    const response = await call(["places", "p1", "a.png"], { "if-none-match": 'W/"etag-1"' });
    assert.equal(response.status, 304);
    assert.equal(response.headers.get("ETag"), '"etag-1"');
    assert.equal(await response.text(), "");
  });

  test("If-None-Match 不命中 → 200", async () => {
    const response = await call(["places", "p1", "a.png"], { "if-none-match": '"other"' });
    assert.equal(response.status, 200);
  });

  test("非白名单类型强制 octet-stream + attachment", async () => {
    stored = {
      httpEtag: '"etag-2"',
      uploaded: new Date("2026-10-19T00:00:00Z"),
      httpMetadata: { contentType: "text/html" },
      body: new Uint8Array([60, 104, 116, 109, 108, 62]).buffer,
    };
    const response = await call(["activities", "a1", "evil.png"]);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "application/octet-stream");
    assert.equal(response.headers.get("Content-Disposition"), "attachment");
  });

  test("前缀白名单之外不查 R2", async () => {
    requested.length = 0;
    const response = await call(["secrets", "a.png"]);
    assert.equal(response.status, 404);
    assert.equal(requested.length, 0);
  });

  test("路径穿越段被拒绝", async () => {
    const response = await call(["places", "..", "a.png"]);
    assert.equal(response.status, 404);
  });

  test("对象不存在 → 404", async () => {
    stored = null;
    const response = await call(["places", "p1", "missing.png"]);
    assert.equal(response.status, 404);
  });

  test("运行环境没有 Cache API 时仍正常回源（best-effort）", async () => {
    stored = {
      httpEtag: '"etag-3"',
      uploaded: new Date("2026-10-19T00:00:00Z"),
      httpMetadata: { contentType: "image/jpeg" },
      body: new Uint8Array([255, 216, 255]).buffer,
    };
    assert.equal(typeof (globalThis as { caches?: unknown }).caches, "undefined");
    const response = await call(["places", "p1", "a.jpg"]);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "image/jpeg");
  });
});
