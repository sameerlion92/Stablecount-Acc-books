import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) }, DB: undefined }, { waitUntil() {}, passThroughOnException() {} });
}

test("server renders Stablecount Acc-books", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Stablecount Acc-books/i);
  assert.match(html, /Business overview/i);
  assert.match(html, /Users &amp; access/i);
  assert.match(html, /Activity history/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});
