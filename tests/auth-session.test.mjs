import assert from "node:assert/strict";
import test from "node:test";

function sessionCookieSecure(env) {
  const override = env.COOKIE_SECURE?.trim().toLowerCase();
  if (override === "true") return true;
  if (override === "false") return false;
  const appUrl = env.APP_URL?.trim();
  if (appUrl) return appUrl.startsWith("https://");
  return false;
}

test("session cookies stay available on HTTP self-hosted servers", () => {
  assert.equal(sessionCookieSecure({ NODE_ENV: "production", APP_URL: "http://100.96.241.115:3000" }), false);
  assert.equal(sessionCookieSecure({ NODE_ENV: "production", APP_URL: "https://books.example.com" }), true);
  assert.equal(sessionCookieSecure({ NODE_ENV: "production", COOKIE_SECURE: "false" }), false);
  assert.equal(sessionCookieSecure({ NODE_ENV: "development" }), false);
});
