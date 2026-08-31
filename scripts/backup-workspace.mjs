#!/usr/bin/env node
/**
 * Creates an organized workspace backup under STABLECOUNT_DATA_DIR/backups/.
 * Usage: STABLECOUNT_DATA_DIR=/path node scripts/backup-workspace.mjs
 */
import { createClient } from "@libsql/client";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_PREFIX = "local:";
const RETENTION = Number(process.env.STABLECOUNT_BACKUP_RETENTION || 30);

function getDataDir() {
  const configured = process.env.STABLECOUNT_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);
  if (process.env.NODE_ENV === "production") return path.join(root, "data");
  return root;
}

function getUploadsDir() {
  const configured = process.env.STABLECOUNT_DATA_DIR?.trim();
  if (configured || process.env.NODE_ENV === "production") return path.join(getDataDir(), "uploads");
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

function slug(value, max = 80) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max) || "unnamed";
}

function localFilePath(ref) {
  const key = ref.startsWith(LOCAL_PREFIX) ? ref.slice(LOCAL_PREFIX.length) : ref;
  return path.join(getUploadsDir(), key);
}

async function copyLocalRef(ref, destPath) {
  if (!ref.startsWith(LOCAL_PREFIX)) return false;
  const srcPath = localFilePath(ref);
  if (!existsSync(srcPath)) return false;
  await mkdir(path.dirname(destPath), { recursive: true });
  await copyFile(srcPath, destPath);
  const metaPath = `${srcPath}.meta.json`;
  if (existsSync(metaPath)) await copyFile(metaPath, `${destPath}.meta.json`);
  return true;
}

async function backupDatabase(destPath) {
  const srcDb = path.join(getDataDir(), "stablecount.db");
  if (!existsSync(srcDb)) throw new Error("Database file not found");
  await mkdir(path.dirname(destPath), { recursive: true });
  const { url, token } = databaseUrl();
  if (url.startsWith("file:")) {
    await copyFile(srcDb, destPath);
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = `${srcDb}${suffix}`;
      if (existsSync(sidecar)) await copyFile(sidecar, `${destPath}${suffix}`);
    }
    return;
  }
  const db = createClient({ url, authToken: token || undefined });
  await db.execute(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`);
}

async function pruneOldBackups(backupsDir) {
  if (!existsSync(backupsDir)) return;
  const folders = [];
  for (const entry of await readdir(backupsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(backupsDir, entry.name);
    folders.push({ full, mtime: (await stat(full)).mtimeMs });
  }
  folders.sort((a, b) => b.mtime - a.mtime);
  for (const folder of folders.slice(RETENTION)) {
    await rm(folder.full, { recursive: true, force: true });
  }
}

async function main() {
  if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    console.log("Skipping local backup because BLOB_READ_WRITE_TOKEN is configured.");
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.join(getDataDir(), "backups", timestamp);
  const filesRoot = path.join(backupRoot, "files");
  const dbBackupPath = path.join(backupRoot, "database", "stablecount.db");

  await mkdir(filesRoot, { recursive: true });
  await backupDatabase(dbBackupPath);

  const { url, token } = databaseUrl();
  const db = createClient({ url, authToken: token || undefined });
  const [clients, orders, documents, templates, invoices] = await Promise.all([
    db.execute("SELECT id, name, kind, email FROM clients"),
    db.execute("SELECT id, order_no, client_id, supplier_id FROM orders"),
    db.execute("SELECT id, client_id, order_id, file_name, object_key, category FROM documents"),
    db.execute("SELECT id, name, header_image_url, footer_image_url FROM invoice_templates"),
    db.execute("SELECT id, invoice_no, client_id, order_id, direction, total, currency, status FROM invoices"),
  ]);

  const clientMap = new Map(clients.rows.map((row) => [Number(row.id), row]));
  const orderMap = new Map(orders.rows.map((row) => [Number(row.id), row]));
  let copiedFiles = 0;

  for (const doc of documents.rows) {
    const ref = String(doc.object_key || "");
    const orderId = doc.order_id ? Number(doc.order_id) : null;
    const clientId = doc.client_id ? Number(doc.client_id) : null;
    let destDir = path.join(filesRoot, "other");

    if (orderId) {
      const order = orderMap.get(orderId);
      const orderNo = order ? String(order.order_no) : String(orderId);
      destDir = path.join(filesRoot, "orders", `${slug(orderNo)}-${orderId}`);
    } else if (clientId) {
      const client = clientMap.get(clientId);
      const name = client ? String(client.name) : String(clientId);
      const kind = client ? String(client.kind) : "customer";
      const bucket = kind === "vendor" ? "suppliers" : "clients";
      destDir = path.join(filesRoot, bucket, `${clientId}-${slug(name)}`);
    }

    destDir = path.join(destDir, slug(String(doc.category || "other")));
    const destName = `${doc.id}-${slug(String(doc.file_name))}`;
    if (await copyLocalRef(ref, path.join(destDir, destName))) copiedFiles += 1;
  }

  for (const template of templates.rows) {
    const templateDir = path.join(filesRoot, "templates", `${template.id}-${slug(String(template.name))}`);
    for (const [field, filename] of [["header_image_url", "header"], ["footer_image_url", "footer"]]) {
      const ref = String(template[field] || "");
      if (!ref.startsWith(LOCAL_PREFIX)) continue;
      const ext = path.extname(localFilePath(ref)) || ".bin";
      if (await copyLocalRef(ref, path.join(templateDir, `${filename}${ext}`))) copiedFiles += 1;
    }
  }

  await mkdir(path.join(backupRoot, "exports"), { recursive: true });
  await writeFile(path.join(backupRoot, "exports", "clients.json"), JSON.stringify(clients.rows, null, 2));
  await writeFile(path.join(backupRoot, "exports", "suppliers.json"), JSON.stringify(clients.rows.filter((row) => row.kind !== "customer"), null, 2));
  await writeFile(path.join(backupRoot, "exports", "orders.json"), JSON.stringify(orders.rows, null, 2));
  await writeFile(path.join(backupRoot, "exports", "invoices.json"), JSON.stringify(invoices.rows, null, 2));
  await writeFile(path.join(backupRoot, "exports", "documents.json"), JSON.stringify(documents.rows, null, 2));

  const manifest = {
    createdAt: new Date().toISOString(),
    reason: process.env.BACKUP_REASON || "scheduled",
    dataDir: getDataDir(),
    counts: {
      clients: clients.rows.filter((row) => row.kind !== "vendor").length,
      suppliers: clients.rows.filter((row) => row.kind !== "customer").length,
      orders: orders.rows.length,
      invoices: invoices.rows.length,
      documents: documents.rows.length,
      copiedFiles,
    },
  };

  await writeFile(path.join(backupRoot, "manifest.json"), JSON.stringify(manifest, null, 2));
  await pruneOldBackups(path.join(getDataDir(), "backups"));
  console.log(`Backup created: ${backupRoot}`);
  console.log(JSON.stringify(manifest.counts));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
