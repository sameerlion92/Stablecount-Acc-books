import { existsSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { database } from "./database";
import { getUploadsDir } from "./paths";
import { deleteObject } from "./storage";

async function wipeUploadTree(dir: string) {
  if (!existsSync(dir)) return;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await wipeUploadTree(full);
    else await rm(full, { force: true });
  }
}

export async function clearBusinessData() {
  const db = database();
  const docs = await db.prepare("SELECT object_key FROM documents").all();
  for (const row of docs.results as Array<{ object_key: string }>) {
    try {
      await deleteObject(String(row.object_key));
    } catch {
      /* file may already be missing */
    }
  }

  await db.batch([
    db.prepare("DELETE FROM journal_lines"),
    db.prepare("DELETE FROM journal_entries"),
    db.prepare("DELETE FROM invoice_items"),
    db.prepare("DELETE FROM payments"),
    db.prepare("DELETE FROM invoices"),
    db.prepare("DELETE FROM shipments"),
    db.prepare("DELETE FROM orders"),
    db.prepare("DELETE FROM documents"),
    db.prepare("DELETE FROM user_client_assignments"),
    db.prepare("DELETE FROM client_supplier_links"),
    db.prepare("DELETE FROM clients"),
    db.prepare("DELETE FROM bank_accounts"),
    db.prepare("DELETE FROM invoice_templates"),
    db.prepare("DELETE FROM exchange_rates"),
    db.prepare("DELETE FROM audit_log"),
    db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('clients','bank_accounts','orders','shipments','invoice_templates','invoices','invoice_items','payments','journal_entries','journal_lines','documents','exchange_rates','client_supplier_links','user_client_assignments','audit_log')"),
  ]);

  const uploadsDir = getUploadsDir();
  await wipeUploadTree(uploadsDir);
  await mkdir(uploadsDir, { recursive: true });

  const summary = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM clients) AS clients,
      (SELECT COUNT(*) FROM orders) AS orders,
      (SELECT COUNT(*) FROM invoices) AS invoices,
      (SELECT COUNT(*) FROM app_users) AS users
  `).first<{ clients: number; orders: number; invoices: number; users: number }>();

  return summary ?? { clients: 0, orders: 0, invoices: 0, users: 0 };
}
