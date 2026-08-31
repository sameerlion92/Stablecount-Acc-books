import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Vercel application exposes the Stablecount workspace and login", async () => {
  const [workspace, login, forgot, reset, packageJson] = await Promise.all([
    readFile(new URL("../app/AccBooksApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/login/forgot/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/reset-password/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(workspace, /StableCount/);
  assert.match(workspace, /Users & access/);
  assert.match(workspace, /Activity history/);
  assert.match(login, /Create the Super Admin/);
  assert.match(login, /Forgot your password/);
  assert.match(login, /New user sign in/);
  assert.match(forgot, /Reset your password/);
  assert.match(reset, /Choose a new password/);
  assert.match(packageJson, /"build": "next build"/);
  assert.doesNotMatch(workspace, /codex-preview|Your site is taking shape/i);
});
