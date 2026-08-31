#!/usr/bin/env node
/**
 * Removes all business records and uploaded files. User accounts and sessions are kept.
 * Usage: CONFIRM=RESET [STABLECOUNT_DATA_DIR=/path] node scripts/clear-business-data.mjs
 */
import { createClient } from "@libsql/client";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function getDataDir() {
  const configured = process.env.STABLECOUNT_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);
  if (process.env.NODE_ENV === "production") return path.join(root, "data");
  return root;
}

function getUploadsDir() {
  const configured = process.env.STABLECOUNT_DATA_DIR?.trim();
  if (configured || process.env.NODE_ENV === "production") {
    return path.join(getDataDir(), "uploads");
  }
  return path.join(root, ".uploads");
}

function databaseUrl() {
  const hosted =
    process.env.DATABASE_URL?.trim() ||
    process.env.TURSO_DATABASE_URL?.trim() ||
    process.env.Stable_TURSO_DATABASE_URL?.trim();
  if (hosted) return { url: hosted, token: process.env.TURSO_AUTH_TOKEN || process.env.Stable_TURSO_AUTH_TOKEN };
  return { url: `file:${path.join(getDataDir(), "stablecount.db")}` };
}

async function removeLocalUpload(ref) {
  const key = ref.startsWith("local:") ? ref.slice("local:".length) : ref;
  const filePath = path.join(getUploadsDir(), key);
  await rm(filePath, { force: true });
  await rm(`${filePath}.meta.json`, { force: true });
}

async function wipeUploadTree(dir) {
  if (!existsSync(dir)) return;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await wipeUploadTree(full);
    else await rm(full, { force: true });
  }
}

async function main() {
  if (process.env.CONFIRM !== "RESET") {
    console.error("This deletes all clients, orders, invoices, banks, documents, templates, and journal data.");
    console.error("User accounts are kept. Run with: CONFIRM=RESET npm run clear-business-data");
    process.exit(1);
  }

  const { url, token } = databaseUrl();
  if (!existsSync(url.replace(/^file:/, "")) && url.startsWith("file:")) {
    console.log("No database file found — workspace is already empty.");
    return;
  }

  const db = createClient({ url, authToken: token || undefined });
  const docs = await db.execute("SELECT object_key FROM documents");
  for (const row of docs.rows) {
    const ref = String(row.object_key || "");
    if (ref.startsWith("local:")) await removeLocalUpload(ref);
  }

  await db.batch([
    "DELETE FROM journal_lines",
    "DELETE FROM journal_entries",
    "DELETE FROM invoice_items",
    "DELETE FROM payments",
    "DELETE FROM invoices",
    "DELETE FROM shipments",
    "DELETE FROM orders",
    "DELETE FROM documents",
    "DELETE FROM user_client_assignments",
    "DELETE FROM client_supplier_links",
    "DELETE FROM clients",
    "DELETE FROM bank_accounts",
    "DELETE FROM invoice_templates",
    "DELETE FROM exchange_rates",
    "DELETE FROM audit_log",
    "DELETE FROM sqlite_sequence WHERE name IN ('clients','bank_accounts','orders','shipments','invoice_templates','invoices','invoice_items','payments','journal_entries','journal_lines','documents','exchange_rates','client_supplier_links','user_client_assignments','audit_log')",
  ].map((sql) => ({ sql, args: [] })), "write");

  await wipeUploadTree(getUploadsDir());
  await mkdir(getUploadsDir(), { recursive: true });

  const counts = await db.execute(`
    SELECT
      (SELECT COUNT(*) FROM clients) AS clients,
      (SELECT COUNT(*) FROM orders) AS orders,
      (SELECT COUNT(*) FROM invoices) AS invoices,
      (SELECT COUNT(*) FROM app_users) AS users
  `);
  const row = counts.rows[0];
  console.log("Business data cleared.");
  console.log(`Remaining — clients: ${row.clients}, orders: ${row.orders}, invoices: ${row.invoices}, users: ${row.users}`);
  console.log("Restart the app if it is running, then sign in and add your real data.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
