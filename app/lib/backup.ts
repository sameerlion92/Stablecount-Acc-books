import { createClient } from "@libsql/client";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDataDir, getDatabaseFilePath, getUploadsDir, resolveDatabaseUrl, storageMode } from "./paths";

const LOCAL_PREFIX = "local:";
const BACKUP_RETENTION = Number(process.env.STABLECOUNT_BACKUP_RETENTION || 30);
const BACKUP_ACTIONS = new Set([
  "client",
  "client-edit",
  "order",
  "order-edit",
  "shipment",
  "status",
  "invoice",
  "invoice-edit",
  "payment",
  "bank",
  "exchange-rate",
  "invoice-template",
  "invoice-template-edit",
  "party-link",
  "delete",
  "document-upload",
]);

type BackupOptions = {
  reason?: string;
};

type Row = Record<string, unknown>;

function slug(value: string, max = 80) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max) || "unnamed";
}

export function getBackupsDir() {
  return path.join(getDataDir(), "backups");
}

function localFilePath(ref: string) {
  const key = ref.startsWith(LOCAL_PREFIX) ? ref.slice(LOCAL_PREFIX.length) : ref;
  return path.join(getUploadsDir(), key);
}

async function copyLocalRef(ref: string, destPath: string) {
  if (!ref.startsWith(LOCAL_PREFIX)) return false;
  const srcPath = localFilePath(ref);
  if (!existsSync(srcPath)) return false;
  await mkdir(path.dirname(destPath), { recursive: true });
  await copyFile(srcPath, destPath);
  const metaPath = `${srcPath}.meta.json`;
  if (existsSync(metaPath)) await copyFile(metaPath, `${destPath}.meta.json`);
  return true;
}

async function backupDatabase(destPath: string) {
  const srcDb = getDatabaseFilePath();
  if (!existsSync(srcDb)) throw new Error("Database file not found");
  await mkdir(path.dirname(destPath), { recursive: true });
  const { url, token } = resolveDatabaseUrl();
  if (url.startsWith("file:")) {
    await copyFile(srcDb, destPath);
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = `${srcDb}${suffix}`;
      if (existsSync(sidecar)) await copyFile(sidecar, `${destPath}${suffix}`);
    }
    return;
  }
  const db = createClient({ url, authToken: token });
  await db.execute(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`);
}

async function pruneOldBackups() {
  const root = getBackupsDir();
  if (!existsSync(root)) return;
  const entries = await readdir(root, { withFileTypes: true });
  const folders = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const full = path.join(root, entry.name);
    folders.push({ full, mtime: (await stat(full)).mtimeMs });
  }
  folders.sort((a, b) => b.mtime - a.mtime);
  for (const folder of folders.slice(BACKUP_RETENTION)) {
    await rm(folder.full, { recursive: true, force: true });
  }
}

export async function runWorkspaceBackup(options: BackupOptions = {}) {
  if (storageMode() === "vercel-blob") {
    return { skipped: true as const, reason: "Hosted blob storage is not backed up locally" };
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = path.join(getBackupsDir(), timestamp);
  const filesRoot = path.join(backupRoot, "files");
  const dbBackupPath = path.join(backupRoot, "database", "stablecount.db");

  await mkdir(filesRoot, { recursive: true });
  await backupDatabase(dbBackupPath);

  const { url, token } = resolveDatabaseUrl();
  const db = createClient({ url, authToken: token });

  const [clients, orders, documents, templates, invoices] = await Promise.all([
    db.execute("SELECT id, name, kind, email FROM clients"),
    db.execute("SELECT id, order_no, client_id, supplier_id FROM orders"),
    db.execute("SELECT id, client_id, order_id, file_name, object_key, category FROM documents"),
    db.execute("SELECT id, name, header_image_url, footer_image_url FROM invoice_templates"),
    db.execute("SELECT id, invoice_no, client_id, order_id, direction, total, currency, status FROM invoices"),
  ]);

  const clientMap = new Map<number, Row>();
  for (const row of clients.rows) clientMap.set(Number(row.id), row);

  const orderMap = new Map<number, Row>();
  for (const row of orders.rows) orderMap.set(Number(row.id), row);

  let copiedFiles = 0;

  for (const doc of documents.rows) {
    const ref = String(doc.object_key || "");
    if (!ref.startsWith(LOCAL_PREFIX)) continue;

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
    for (const [field, filename] of [["header_image_url", "header"], ["footer_image_url", "footer"]] as const) {
      const ref = String(template[field] || "");
      if (!ref.startsWith(LOCAL_PREFIX)) continue;
      const ext = path.extname(localFilePath(ref)) || ".bin";
      if (await copyLocalRef(ref, path.join(templateDir, `${filename}${ext}`))) copiedFiles += 1;
    }
  }

  const clientsCount = clients.rows.filter((row) => row.kind !== "vendor").length;
  const suppliersCount = clients.rows.filter((row) => row.kind !== "customer").length;

  await mkdir(path.join(backupRoot, "exports"), { recursive: true });
  await writeFile(path.join(backupRoot, "exports", "clients.json"), JSON.stringify(clients.rows, null, 2));
  await writeFile(path.join(backupRoot, "exports", "suppliers.json"), JSON.stringify(clients.rows.filter((row) => row.kind !== "customer"), null, 2));
  await writeFile(path.join(backupRoot, "exports", "orders.json"), JSON.stringify(orders.rows, null, 2));
  await writeFile(path.join(backupRoot, "exports", "invoices.json"), JSON.stringify(invoices.rows, null, 2));
  await writeFile(path.join(backupRoot, "exports", "documents.json"), JSON.stringify(documents.rows, null, 2));

  const manifest = {
    createdAt: new Date().toISOString(),
    reason: options.reason || "manual",
    dataDir: getDataDir(),
    counts: {
      clients: clientsCount,
      suppliers: suppliersCount,
      orders: orders.rows.length,
      invoices: invoices.rows.length,
      documents: documents.rows.length,
      copiedFiles,
    },
    layout: {
      database: "database/stablecount.db",
      files: {
        clients: "files/clients/{clientId}-{name}/{category}/",
        suppliers: "files/suppliers/{supplierId}-{name}/{category}/",
        orders: "files/orders/{orderNo}-{orderId}/{category}/",
        templates: "files/templates/{templateId}-{name}/",
      },
      exports: "exports/*.json",
    },
  };

  await writeFile(path.join(backupRoot, "manifest.json"), JSON.stringify(manifest, null, 2));
  await pruneOldBackups();

  return { skipped: false as const, backupDir: backupRoot, manifest };
}

let backupTimer: ReturnType<typeof setTimeout> | null = null;
let backupRunning = false;

export function shouldQueueBackup(action?: string) {
  if (!action) return false;
  return BACKUP_ACTIONS.has(action);
}

export function queueWorkspaceBackup(action?: string) {
  if (storageMode() === "vercel-blob") return;
  if (action && !shouldQueueBackup(action)) return;
  if (backupTimer) clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    backupTimer = null;
    if (backupRunning) return;
    backupRunning = true;
    void runWorkspaceBackup({ reason: action || "scheduled" })
      .catch((error) => console.error("[backup]", error instanceof Error ? error.message : error))
      .finally(() => {
        backupRunning = false;
      });
  }, 8000);
}
