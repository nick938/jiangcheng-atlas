import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEndpoint, runMonitor } from "./monitor.mjs";

const options = { sleep: async () => {}, log: () => {} };

test("health accepts JSON whitespace and recovers from a transient 503", async () => {
  let calls = 0;
  const result = await checkEndpoint("https://example.com/api/health", {
    ...options, health: true,
    fetchImpl: async () => ++calls === 1 ? new Response("unavailable", { status: 503 }) : new Response('{ "status": "ok" }'),
  });
  assert.equal(result.ok, true);
  assert.equal(result.history.length, 2);
  assert.equal(result.history[0].status, 503);
});

test("a persistent Cloudflare challenge fails and preserves diagnostics", async () => {
  const result = await checkEndpoint("https://example.com/api/health", {
    ...options, health: true,
    fetchImpl: async () => new Response("challenge", { status: 403, headers: { "cf-ray": "test-ray", "cf-mitigated": "challenge" } }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.history.length, 4);
  assert.equal(result.ray, "test-ray");
  assert.equal(result.mitigation, "challenge");
});

test("HTTP 200 with invalid health JSON still fails", async () => {
  for (const body of ["<html>challenge</html>", '{"status":"unavailable"}']) {
    const result = await checkEndpoint("https://example.com/api/health", { ...options, health: true, attempts: 1, fetchImpl: async () => new Response(body) });
    assert.equal(result.ok, false);
  }
});

test("network errors and redirects fail without skipping other endpoints", async () => {
  const results = await runMonitor("https://example.com", {
    ...options, attempts: 1,
    fetchImpl: async url => {
      if (url.endsWith("/api/health")) throw new Error("network down");
      if (url.endsWith("/robots.txt")) return new Response(null, { status: 302 });
      return new Response("ok");
    },
  });
  assert.equal(results.length, 4);
  assert.equal(results[0].error, "network down");
  assert.equal(results[1].ok, true);
  assert.equal(results[3].ok, false);
});
