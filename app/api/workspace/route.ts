import { deleteObject } from "../../lib/storage";
import { changePassword, clearUserPassword, createPlatformUserId, getSessionIdentity, setUserPassword } from "../../lib/auth";
import { canViewAuditLog, logAudit } from "../../lib/audit";
import { buildFinancialSummary } from "../../lib/financial-summary";
import { database as vercelDatabase } from "../../lib/database";
import { ensureDataDirs } from "../../lib/paths";
import { clearBusinessData } from "../../lib/clear-business-data";

type Payload = Record<string, unknown> & { action?: string };
export type Actor = {
  id: number;
  platformUserId: string;
  email: string;
  displayName: string;
  role: "super_admin"|"manager"|"operator";
  status: string;
  language: string;
  defaultView: string;
  dateFormat: string;
  compactMode: boolean;
  reportingCurrency: string;
  timeFormat: "12h"|"24h";
  timezone: string;
  numberLocale: string;
  defaultInvoiceCurrency: string;
  defaultOrderCurrency: string;
  showTimestamps: boolean;
};
const MAX_SEATS = 10;
const VALID_LANGUAGES = new Set(["en", "ru", "ar", "de", "es", "pt"]);
const VALID_VIEWS = new Set(["overview", "clients", "suppliers", "orders", "invoices", "banks", "bookkeeping", "reports", "master", "users", "activity", "settings"]);
const VALID_DATE_FORMATS = new Set(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]);
const VALID_TIME_FORMATS = new Set(["12h", "24h"]);
const VALID_TIMEZONES = new Set(["UTC", "Europe/London", "Europe/Berlin", "Europe/Moscow", "Europe/Paris", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "America/New_York", "America/Chicago", "America/Los_Angeles", "Australia/Sydney"]);
const VALID_NUMBER_LOCALES = new Set(["en-US", "en-GB", "de-DE", "ru-RU", "fr-FR", "es-ES", "ar-SA", "pt-BR"]);

function actorFromRow(row: Record<string, unknown>, email: string, displayName: string, platformUserId: string): Actor {
  return {
    id: Number(row.id),
    platformUserId,
    email,
    displayName,
    role: String(row.role) as Actor["role"],
    status: String(row.status || "active"),
    language: String(row.language || "en"),
    defaultView: String(row.default_view || "overview"),
    dateFormat: String(row.date_format || "DD/MM/YYYY"),
    compactMode: Boolean(row.compact_mode),
    reportingCurrency: String(row.reporting_currency || "RUB"),
    timeFormat: String(row.time_format || "24h") as Actor["timeFormat"],
    timezone: String(row.timezone || "UTC"),
    numberLocale: String(row.number_locale || "en-US"),
    defaultInvoiceCurrency: String(row.default_invoice_currency || "RUB"),
    defaultOrderCurrency: String(row.default_order_currency || "RUB"),
    showTimestamps: row.show_timestamps !== 0,
  };
}

function currencyCode(value: unknown, fallback: string) {
  const code = String(value ?? fallback).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error("Invalid currency code");
  return code;
}

type SqlDatabase = ReturnType<typeof database>;

async function nextPrefixedNumber(db: SqlDatabase, table: "orders"|"shipments", column: "order_no"|"shipment_no", prefix: string, floor: number) {
  const row = await db.prepare(`SELECT MAX(CAST(SUBSTR(${column}, ?) AS INTEGER)) AS max_no FROM ${table} WHERE ${column} LIKE ?`).bind(prefix.length + 1, `${prefix}%`).first<{ max_no: number | null }>();
  const highest = Number(row?.max_no);
  const next = (Number.isFinite(highest) ? Math.max(floor, highest) : floor - 1) + 1;
  return `${prefix}${next}`;
}

async function nextInvoiceNumber(db: SqlDatabase, prefix: string) {
  const likePrefix = `${prefix}-`;
  const row = await db.prepare("SELECT MAX(CAST(SUBSTR(invoice_no, ?) AS INTEGER)) AS max_no FROM invoices WHERE invoice_no LIKE ?").bind(likePrefix.length + 1, `${likePrefix}%`).first<{ max_no: number | null }>();
  const highest = Number(row?.max_no);
  const next = (Number.isFinite(highest) ? highest : 0) + 1;
  return `${likePrefix}${String(next).padStart(4, "0")}`;
}

type InvoiceLineItem = { description: string; quantity: number; unitPrice: number };

function parseLineItems(payload: Record<string, unknown>): InvoiceLineItem[] {
  const raw = payload.lineItemsJson ?? payload.lineItems;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const lines = parsed.map((row) => {
          const item = row as Record<string, unknown>;
          const description = String(item.description ?? "").trim();
          const quantity = Number(item.quantity ?? 1);
          const unitPrice = Number(item.unitPrice ?? item.unit_price ?? 0);
          return {
            description,
            quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
            unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
          };
        }).filter((line) => line.description);
        if (lines.length) return lines;
      }
    } catch { /* fall through to legacy single-line fields */ }
  }
  const description = String(payload.description ?? "").trim();
  if (description) {
    const quantity = Number(payload.quantity ?? 1);
    const unitPrice = Number(payload.unitPrice ?? 0);
    return [{
      description,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
    }];
  }
  throw new Error("Add at least one line item with a description");
}

function lineItemsSubtotal(lines: InvoiceLineItem[]) {
  return lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
}

async function saveInvoiceItems(db: SqlDatabase, invoiceId: number, lines: InvoiceLineItem[]) {
  await db.prepare("DELETE FROM invoice_items WHERE invoice_id=?").bind(invoiceId).run();
  for (const line of lines) {
    await db.prepare("INSERT INTO invoice_items (invoice_id,description,quantity,unit_price) VALUES (?,?,?,?)").bind(invoiceId, line.description, line.quantity, line.unitPrice).run();
  }
}

async function deleteInvoiceCascade(db: SqlDatabase, invoiceId: number) {
  const payments = await db.prepare("SELECT amount, direction, bank_account_id FROM payments WHERE invoice_id=?").bind(invoiceId).all();
  for (const payment of payments.results as Array<{ amount: number; direction: string; bank_account_id: number }>) {
    const amount = Number(payment.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const operator = payment.direction === "in" ? "-" : "+";
    await db.prepare(`UPDATE bank_accounts SET balance=balance ${operator} ? WHERE id=?`).bind(amount, payment.bank_account_id).run();
  }
  const entries = await db.prepare("SELECT id FROM journal_entries WHERE reference_id=? AND reference_type IN ('invoice','bill','payment')").bind(invoiceId).all();
  for (const entry of entries.results as Array<{ id: number }>) {
    await db.prepare("DELETE FROM journal_lines WHERE entry_id=?").bind(entry.id).run();
  }
  await db.prepare("DELETE FROM journal_entries WHERE reference_id=? AND reference_type IN ('invoice','bill','payment')").bind(invoiceId).run();
  await db.prepare("DELETE FROM payments WHERE invoice_id=?").bind(invoiceId).run();
  await db.prepare("DELETE FROM invoice_items WHERE invoice_id=?").bind(invoiceId).run();
  await db.prepare("DELETE FROM invoices WHERE id=?").bind(invoiceId).run();
}

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '', contact_person TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL DEFAULT 'USD', bank_name TEXT NOT NULL DEFAULT '', bank_reference TEXT NOT NULL DEFAULT '', bank_account_number TEXT NOT NULL DEFAULT '', beneficiary_name TEXT NOT NULL DEFAULT '', bank_address TEXT NOT NULL DEFAULT '', swift_code TEXT NOT NULL DEFAULT '', ifsc_code TEXT NOT NULL DEFAULT '', commission_earned REAL NOT NULL DEFAULT 0, kind TEXT NOT NULL DEFAULT 'customer', is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS client_supplier_links (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL REFERENCES clients(id), supplier_id INTEGER NOT NULL REFERENCES clients(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS user_client_assignments (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES app_users(id), client_id INTEGER NOT NULL REFERENCES clients(id), assigned_by INTEGER NOT NULL REFERENCES app_users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS bank_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, nickname TEXT NOT NULL, bank_name TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', account_last4 TEXT NOT NULL, balance REAL NOT NULL DEFAULT 0, is_default INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, order_no TEXT NOT NULL UNIQUE, client_id INTEGER NOT NULL REFERENCES clients(id), supplier_id INTEGER REFERENCES clients(id), description TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'RUB', purchase_price REAL NOT NULL DEFAULT 0, sale_price REAL NOT NULL DEFAULT 0, commission_percent REAL NOT NULL DEFAULT 0, purchase_currency TEXT NOT NULL DEFAULT 'RUB', sale_currency TEXT NOT NULL DEFAULT 'RUB', purchase_invoice_details TEXT NOT NULL DEFAULT '', sales_invoice_details TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Confirmed', expected_date TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS shipments (id INTEGER PRIMARY KEY AUTOINCREMENT, shipment_no TEXT NOT NULL UNIQUE, order_id INTEGER NOT NULL REFERENCES orders(id), carrier TEXT NOT NULL DEFAULT '', tracking_no TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Preparing', eta TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS invoice_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, direction TEXT NOT NULL DEFAULT 'sale', number_prefix TEXT NOT NULL DEFAULT 'INV', title TEXT NOT NULL DEFAULT 'INVOICE', seller_name TEXT NOT NULL, seller_address TEXT NOT NULL DEFAULT '', seller_email TEXT NOT NULL DEFAULT '', seller_phone TEXT NOT NULL DEFAULT '', tax_registration TEXT NOT NULL DEFAULT '', bank_details TEXT NOT NULL DEFAULT '', payment_terms TEXT NOT NULL DEFAULT 'Payment due within 30 days', footer TEXT NOT NULL DEFAULT 'Thank you for your business', accent_color TEXT NOT NULL DEFAULT '#176f8f', custom_fields_json TEXT NOT NULL DEFAULT '[]', is_active INTEGER NOT NULL DEFAULT 1, created_by INTEGER NOT NULL REFERENCES app_users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_no TEXT NOT NULL UNIQUE, client_id INTEGER NOT NULL REFERENCES clients(id), bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id), order_id INTEGER REFERENCES orders(id), template_id INTEGER REFERENCES invoice_templates(id), direction TEXT NOT NULL DEFAULT 'sale', issue_date TEXT NOT NULL, due_date TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', subtotal REAL NOT NULL DEFAULT 0, tax_rate REAL NOT NULL DEFAULT 0, tax_amount REAL NOT NULL DEFAULT 0, discount_amount REAL NOT NULL DEFAULT 0, shipping_amount REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0, reference TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Sent', notes TEXT NOT NULL DEFAULT '', template_snapshot TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS invoice_items (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL REFERENCES invoices(id), description TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 1, unit_price REAL NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER REFERENCES invoices(id), client_id INTEGER NOT NULL REFERENCES clients(id), bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id), direction TEXT NOT NULL, amount REAL NOT NULL, payment_date TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS journal_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, entry_date TEXT NOT NULL, reference_type TEXT NOT NULL, reference_id INTEGER NOT NULL, memo TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS journal_lines (id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id INTEGER NOT NULL REFERENCES journal_entries(id), account_code TEXT NOT NULL, account_name TEXT NOT NULL, debit REAL NOT NULL DEFAULT 0, credit REAL NOT NULL DEFAULT 0, client_id INTEGER REFERENCES clients(id))`,
  `CREATE TABLE IF NOT EXISTS app_users (id INTEGER PRIMARY KEY AUTOINCREMENT, platform_user_id TEXT UNIQUE, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'operator', status TEXT NOT NULL DEFAULT 'invited', language TEXT NOT NULL DEFAULT 'en', default_view TEXT NOT NULL DEFAULT 'overview', date_format TEXT NOT NULL DEFAULT 'DD/MM/YYYY', compact_mode INTEGER NOT NULL DEFAULT 0, last_seen_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES app_users(id), action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, description TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS exchange_rates (id INTEGER PRIMARY KEY AUTOINCREMENT, base_currency TEXT NOT NULL, quote_currency TEXT NOT NULL, rate REAL NOT NULL, effective_date TEXT NOT NULL, created_by INTEGER NOT NULL REFERENCES app_users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER REFERENCES clients(id), order_id INTEGER REFERENCES orders(id), file_name TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE, content_type TEXT NOT NULL, size INTEGER NOT NULL, category TEXT NOT NULL DEFAULT 'Other', status TEXT NOT NULL DEFAULT 'Uploaded', created_by INTEGER NOT NULL REFERENCES app_users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `UPDATE app_users SET role='super_admin' WHERE role='admin'`,
  `UPDATE app_users SET role='manager' WHERE role='accountant'`,
  `UPDATE app_users SET role='operator' WHERE role='viewer'`,
  `CREATE INDEX IF NOT EXISTS idx_orders_client_id ON orders(client_id)`,
  `CREATE INDEX IF NOT EXISTS idx_shipments_order_id ON shipments(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_invoices_client_status ON invoices(client_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_invoices_order_id ON invoices(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_invoice_templates_active ON invoice_templates(is_active,direction)`,
  `CREATE INDEX IF NOT EXISTS idx_payments_client_direction ON payments(client_id, direction)`,
  `CREATE INDEX IF NOT EXISTS idx_journal_lines_entry_id ON journal_lines(entry_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_documents_client_id ON documents(client_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_client_supplier_unique ON client_supplier_links(client_id,supplier_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_user_client_unique ON user_client_assignments(user_id,client_id)`,
  `CREATE INDEX IF NOT EXISTS idx_user_client_user ON user_client_assignments(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_user_client_client ON user_client_assignments(client_id)`,
];

export function database() {
  return vercelDatabase();
}

export async function prepareDatabase() {
  await ensureDataDirs();
  const db = database();
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));
  const clientColumns=await db.prepare("PRAGMA table_info(clients)").all();
  const clientColumnNames=new Set(clientColumns.results.map(column=>String((column as Record<string,unknown>).name)));
  const clientAdditions=["is_active INTEGER NOT NULL DEFAULT 1","website TEXT NOT NULL DEFAULT ''","contact_person TEXT NOT NULL DEFAULT ''","bank_account_number TEXT NOT NULL DEFAULT ''","beneficiary_name TEXT NOT NULL DEFAULT ''","bank_address TEXT NOT NULL DEFAULT ''","swift_code TEXT NOT NULL DEFAULT ''","ifsc_code TEXT NOT NULL DEFAULT ''","commission_earned REAL NOT NULL DEFAULT 0","director_ceo_name TEXT NOT NULL DEFAULT ''","director_phone TEXT NOT NULL DEFAULT ''","director_email TEXT NOT NULL DEFAULT ''","inn TEXT NOT NULL DEFAULT ''","kpp TEXT NOT NULL DEFAULT ''","ogrn TEXT NOT NULL DEFAULT ''","contact_position TEXT NOT NULL DEFAULT ''","contact_email TEXT NOT NULL DEFAULT ''","contact_tel TEXT NOT NULL DEFAULT ''","contact_mob TEXT NOT NULL DEFAULT ''"];
  for(const addition of clientAdditions){const name=addition.split(" ")[0];if(!clientColumnNames.has(name))await db.prepare(`ALTER TABLE clients ADD COLUMN ${addition}`).run();}
  const orderColumns=await db.prepare("PRAGMA table_info(orders)").all();
  const orderColumnNames=new Set(orderColumns.results.map(column=>String((column as Record<string,unknown>).name)));
  const orderAdditions=["supplier_id INTEGER REFERENCES clients(id)","purchase_price REAL NOT NULL DEFAULT 0","sale_price REAL NOT NULL DEFAULT 0","commission_percent REAL NOT NULL DEFAULT 0","purchase_currency TEXT NOT NULL DEFAULT 'RUB'","sale_currency TEXT NOT NULL DEFAULT 'RUB'","purchase_invoice_details TEXT NOT NULL DEFAULT ''","sales_invoice_details TEXT NOT NULL DEFAULT ''"];
  for(const addition of orderAdditions){const name=addition.split(" ")[0];if(!orderColumnNames.has(name))await db.prepare(`ALTER TABLE orders ADD COLUMN ${addition}`).run();}
  await db.prepare("UPDATE orders SET sale_price=amount WHERE sale_price=0 AND amount!=0").run();
  await db.prepare("UPDATE orders SET sale_currency=currency WHERE sale_currency='RUB' AND currency!='RUB'").run();
  const documentColumns=await db.prepare("PRAGMA table_info(documents)").all();
  if(!documentColumns.results.some(column=>String((column as Record<string,unknown>).name)==="order_id"))await db.prepare("ALTER TABLE documents ADD COLUMN order_id INTEGER REFERENCES orders(id)").run();
  const userColumns=await db.prepare("PRAGMA table_info(app_users)").all();
  const userColumnNames=new Set(userColumns.results.map(column=>String((column as Record<string,unknown>).name)));
  const userAdditions=["password_hash TEXT","language TEXT NOT NULL DEFAULT 'en'","default_view TEXT NOT NULL DEFAULT 'overview'","date_format TEXT NOT NULL DEFAULT 'DD/MM/YYYY'","compact_mode INTEGER NOT NULL DEFAULT 0","reporting_currency TEXT NOT NULL DEFAULT 'RUB'","time_format TEXT NOT NULL DEFAULT '24h'","timezone TEXT NOT NULL DEFAULT 'UTC'","number_locale TEXT NOT NULL DEFAULT 'en-US'","default_invoice_currency TEXT NOT NULL DEFAULT 'RUB'","default_order_currency TEXT NOT NULL DEFAULT 'RUB'","show_timestamps INTEGER NOT NULL DEFAULT 1"];
  for(const addition of userAdditions){const name=addition.split(" ")[0];if(!userColumnNames.has(name))await db.prepare(`ALTER TABLE app_users ADD COLUMN ${addition}`).run();}
  const brokenPlatformIds=await db.prepare("SELECT id FROM app_users WHERE platform_user_id IS NULL OR platform_user_id='null'").all();
  for(const row of brokenPlatformIds.results as Array<{id:number}>){await db.prepare("UPDATE app_users SET platform_user_id=? WHERE id=?").bind(createPlatformUserId(),row.id).run();}
  const invoiceColumns=await db.prepare("PRAGMA table_info(invoices)").all();
  const invoiceColumnNames=new Set(invoiceColumns.results.map(column=>String((column as Record<string,unknown>).name)));
  const invoiceAdditions=["template_id INTEGER REFERENCES invoice_templates(id)","tax_rate REAL NOT NULL DEFAULT 0","tax_amount REAL NOT NULL DEFAULT 0","discount_amount REAL NOT NULL DEFAULT 0","shipping_amount REAL NOT NULL DEFAULT 0","reference TEXT NOT NULL DEFAULT ''","template_snapshot TEXT NOT NULL DEFAULT '{}'"];
  for(const addition of invoiceAdditions){const name=addition.split(" ")[0];if(!invoiceColumnNames.has(name))await db.prepare(`ALTER TABLE invoices ADD COLUMN ${addition}`).run();}
  const templateColumns=await db.prepare("PRAGMA table_info(invoice_templates)").all();
  const templateColumnNames=new Set(templateColumns.results.map(column=>String((column as Record<string,unknown>).name)));
  const templateAdditions=["header_text TEXT NOT NULL DEFAULT ''","header_image_url TEXT NOT NULL DEFAULT ''","footer_image_url TEXT NOT NULL DEFAULT ''"];
  for(const addition of templateAdditions){const name=addition.split(" ")[0];if(!templateColumnNames.has(name))await db.prepare(`ALTER TABLE invoice_templates ADD COLUMN ${addition}`).run();}
  await db.batch([db.prepare("CREATE INDEX IF NOT EXISTS idx_orders_supplier_id ON orders(supplier_id)"),db.prepare("CREATE INDEX IF NOT EXISTS idx_documents_order_id ON documents(order_id)"),db.prepare("CREATE INDEX IF NOT EXISTS idx_invoices_order_id ON invoices(order_id)"),db.prepare("CREATE INDEX IF NOT EXISTS idx_invoice_templates_active ON invoice_templates(is_active,direction)")]);
}

export async function authenticate(request: Request): Promise<Actor> {
  void request;
  const identity = await getSessionIdentity();
  if (!identity) throw new Error("AUTH_REQUIRED");
  const db = database();
  let row = await db.prepare("SELECT id, platform_user_id, email, display_name, role, status, language, default_view, date_format, compact_mode, reporting_currency, time_format, timezone, number_locale, default_invoice_currency, default_order_currency, show_timestamps FROM app_users WHERE platform_user_id=? OR lower(email)=lower(?) LIMIT 1").bind(identity.userId, identity.email).first<Record<string, unknown>>();
  const seatCount = await db.prepare("SELECT COUNT(*) AS count FROM app_users WHERE status!='disabled'").first<{count:number}>();
  if (!row && Number(seatCount?.count ?? 0) === 0) {
    row = await db.prepare("INSERT INTO app_users (platform_user_id,email,display_name,role,status,last_seen_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP) RETURNING id,platform_user_id,email,display_name,role,status,language,default_view,date_format,compact_mode,reporting_currency,time_format,timezone,number_locale,default_invoice_currency,default_order_currency,show_timestamps").bind(identity.userId,identity.email,identity.displayName,"super_admin","active").first<Record<string,unknown>>();
    if (row) await db.prepare("INSERT INTO audit_log (user_id,action,entity_type,entity_id,description,details_json) VALUES (?,?,?,?,?,?)").bind(row.id,"activated","user",String(row.id),`${identity.displayName} activated the Super Admin seat`,JSON.stringify({email:identity.email,role:"super_admin"})).run();
  }
  if (!row) throw new Error("SEAT_REQUIRED");
  if (row.status === "disabled") throw new Error("ACCOUNT_DISABLED");
  const wasInvited = row.status === "invited";
  const nextPlatformUserId = row.platform_user_id
    ? String(row.platform_user_id)
    : identity.userId.startsWith("vercel:")
      ? identity.userId
      : createPlatformUserId();
  await db.prepare("UPDATE app_users SET platform_user_id=?, status='active', last_seen_at=CURRENT_TIMESTAMP WHERE id=?").bind(nextPlatformUserId, row.id).run();
  if (wasInvited) await db.prepare("INSERT INTO audit_log (user_id,action,entity_type,entity_id,description,details_json) VALUES (?,?,?,?,?,?)").bind(row.id,"activated","user",String(row.id),`${String(row.display_name || identity.displayName)} activated their user seat`,JSON.stringify({email:identity.email,role:row.role})).run();
  return actorFromRow(row, identity.email, String(row.display_name || identity.displayName), nextPlatformUserId);
}

export async function audit(actor: Actor, action: string, entityType: string, entityId: string|number, description: string, details: Record<string, unknown> = {}) {
  await logAudit(actor.id, action, entityType, entityId, description, details);
}

export { canViewAuditLog };

function canAssignClients(actor: Actor) {
  return actor.role === "super_admin" || actor.role === "manager";
}

async function operatorClientIds(db: SqlDatabase, userId: number) {
  const rows = await db.prepare("SELECT client_id FROM user_client_assignments WHERE user_id=?").bind(userId).all();
  return (rows.results as Array<{ client_id: number }>).map((row) => Number(row.client_id));
}

async function assertOperatorClientAccess(db: SqlDatabase, actor: Actor, clientId: number) {
  if (actor.role !== "operator") return;
  const allowed = await operatorClientIds(db, actor.id);
  if (!allowed.includes(clientId)) throw new Error("You are not assigned to this client");
}

async function assertAssignableOperator(db: SqlDatabase, userId: number) {
  const user = await db.prepare("SELECT id,display_name,role FROM app_users WHERE id=?").bind(userId).first<{ id: number; display_name: string; role: string }>();
  if (!user) throw new Error("User not found");
  if (user.role !== "operator") throw new Error("Clients can only be assigned to Level 2 operators");
  return user;
}

async function assertAssignableClient(db: SqlDatabase, clientId: number) {
  const client = await db.prepare("SELECT id,name,kind FROM clients WHERE id=? AND is_active=1").bind(clientId).first<{ id: number; name: string; kind: string }>();
  if (!client) throw new Error("Client not found");
  if (client.kind === "vendor") throw new Error("Only clients can be assigned to operators");
  return client;
}

function filterByClientIds<T extends Record<string, unknown>>(rows: T[], key: string, allowed: Set<number>) {
  if (!allowed.size) return [];
  return rows.filter((row) => allowed.has(Number(row[key])));
}

async function snapshot(actor: Actor) {
  const db = database();
  const activityQuery = canViewAuditLog(actor.role)
    ? db.prepare("SELECT a.id,a.user_id,a.action,a.entity_type,a.entity_id,a.description,a.details_json,a.created_at,u.display_name,u.email,u.role FROM audit_log a JOIN app_users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 500").all()
    : Promise.resolve({ results: [] });
  const [clients, banks, orders, shipments, invoices, invoiceItems, journal, users, activity, rates, documents, partyLinks, invoiceTemplates, clientAssignments] = await Promise.all([
    db.prepare(`SELECT c.*, COALESCE(SUM(CASE WHEN i.direction='sale' AND i.status NOT IN ('Cancelled') THEN i.total ELSE 0 END),0)-COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.client_id=c.id AND p.direction='in'),0) AS receivable, COALESCE(SUM(CASE WHEN i.direction='purchase' AND i.status NOT IN ('Cancelled') THEN i.total ELSE 0 END),0)-COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.client_id=c.id AND p.direction='out'),0) AS payable FROM clients c LEFT JOIN invoices i ON i.client_id=c.id WHERE c.is_active=1 GROUP BY c.id ORDER BY c.name`).all(),
    db.prepare("SELECT * FROM bank_accounts WHERE is_active=1 ORDER BY is_default DESC, nickname").all(),
    db.prepare("SELECT o.*, c.name AS client_name, s.name AS supplier_name FROM orders o JOIN clients c ON c.id=o.client_id LEFT JOIN clients s ON s.id=o.supplier_id ORDER BY o.id DESC").all(),
    db.prepare("SELECT s.*, o.order_no, c.id AS client_id, c.name AS client_name FROM shipments s JOIN orders o ON o.id=s.order_id JOIN clients c ON c.id=o.client_id ORDER BY s.id DESC").all(),
    db.prepare("SELECT i.*, c.name AS client_name, b.nickname AS bank_name, o.order_no, t.name AS template_name, (SELECT description FROM invoice_items ii WHERE ii.invoice_id=i.id ORDER BY ii.id LIMIT 1) AS item_description, (SELECT quantity FROM invoice_items ii WHERE ii.invoice_id=i.id ORDER BY ii.id LIMIT 1) AS item_quantity, (SELECT unit_price FROM invoice_items ii WHERE ii.invoice_id=i.id ORDER BY ii.id LIMIT 1) AS item_unit_price, (SELECT COUNT(*) FROM invoice_items ii WHERE ii.invoice_id=i.id) AS item_count, COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id=i.id),0) AS paid_amount FROM invoices i JOIN clients c ON c.id=i.client_id JOIN bank_accounts b ON b.id=i.bank_account_id LEFT JOIN orders o ON o.id=i.order_id LEFT JOIN invoice_templates t ON t.id=i.template_id ORDER BY i.id DESC").all(),
    db.prepare("SELECT * FROM invoice_items ORDER BY invoice_id, id").all(),
    db.prepare("SELECT je.*, jl.account_code, jl.account_name, jl.debit, jl.credit, jl.client_id, c.name AS client_name FROM journal_entries je JOIN journal_lines jl ON jl.entry_id=je.id LEFT JOIN clients c ON c.id=jl.client_id ORDER BY je.id DESC, jl.id").all(),
    db.prepare("SELECT id,email,display_name,role,status,language,default_view,date_format,compact_mode,last_seen_at,created_at FROM app_users ORDER BY CASE role WHEN 'super_admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, display_name").all(),
    activityQuery,
    db.prepare("SELECT r.*,u.display_name AS created_by_name FROM exchange_rates r JOIN app_users u ON u.id=r.created_by ORDER BY r.effective_date DESC,r.id DESC").all(),
    db.prepare("SELECT d.*,c.name AS client_name,o.order_no,u.display_name AS uploaded_by FROM documents d LEFT JOIN clients c ON c.id=d.client_id LEFT JOIN orders o ON o.id=d.order_id JOIN app_users u ON u.id=d.created_by ORDER BY d.id DESC").all(),
    db.prepare("SELECT * FROM client_supplier_links ORDER BY id DESC").all(),
    db.prepare("SELECT t.*,u.display_name AS created_by_name FROM invoice_templates t JOIN app_users u ON u.id=t.created_by WHERE t.is_active=1 ORDER BY t.id DESC").all(),
    db.prepare("SELECT uca.id,uca.user_id,uca.client_id,uca.assigned_by,uca.created_at,c.name AS client_name,u.display_name AS user_name,ab.display_name AS assigned_by_name FROM user_client_assignments uca JOIN clients c ON c.id=uca.client_id JOIN app_users u ON u.id=uca.user_id JOIN app_users ab ON ab.id=uca.assigned_by ORDER BY u.display_name,c.name").all(),
  ]);
  let clientRows = clients.results as Record<string, unknown>[];
  let bankRows = banks.results as Record<string, unknown>[];
  let orderRows = orders.results as Record<string, unknown>[];
  let shipmentRows = shipments.results as Record<string, unknown>[];
  let invoiceRows = invoices.results as Record<string, unknown>[];
  let invoiceItemRows = invoiceItems.results as Record<string, unknown>[];
  let journalRows = journal.results as Record<string, unknown>[];
  let documentRows = documents.results as Record<string, unknown>[];
  let partyLinkRows = partyLinks.results as Record<string, unknown>[];
  const assignmentRows = clientAssignments.results as Record<string, unknown>[];
  if (actor.role === "operator") {
    const allowed = new Set(await operatorClientIds(db, actor.id));
    clientRows = filterByClientIds(clientRows, "id", allowed);
    orderRows = filterByClientIds(orderRows, "client_id", allowed);
    shipmentRows = shipmentRows.filter((row) => allowed.has(Number(row.client_id)));
    invoiceRows = filterByClientIds(invoiceRows, "client_id", allowed);
    const invoiceIds = new Set(invoiceRows.map((row) => Number(row.id)));
    invoiceItemRows = invoiceItemRows.filter((row) => invoiceIds.has(Number(row.invoice_id)));
    journalRows = journalRows.filter((row) => row.client_id == null || allowed.has(Number(row.client_id)));
    documentRows = documentRows.filter((row) => row.client_id == null || allowed.has(Number(row.client_id)));
    partyLinkRows = filterByClientIds(partyLinkRows, "client_id", allowed);
  }
  const summary = buildFinancialSummary({
    clients: clientRows,
    banks: bankRows,
    invoices: invoiceRows,
    reportingCurrency: actor.reportingCurrency,
    rates: rates.results as Array<{ base_currency: string; quote_currency: string; rate: number; effective_date: string }>,
  });
  return { clients: clientRows, banks: bankRows, orders: orderRows, shipments: shipmentRows, invoices: invoiceRows, invoiceItems: invoiceItemRows, invoiceTemplates:invoiceTemplates.results, journal: journalRows, users: users.results, activity: activity.results, rates: rates.results, documents: documentRows, partyLinks:partyLinkRows, clientAssignments: assignmentRows, currentUser: actor, reportingCurrency: actor.reportingCurrency, seats: { used: users.results.filter((row) => (row as Record<string,unknown>).status !== "disabled").length, limit: MAX_SEATS }, summary };
}

function required(payload: Payload, field: string) {
  const value = String(payload[field] ?? "").trim();
  if (!value) throw new Error(`${field} is required`);
  return value;
}

function customFields(value: unknown) {
  return JSON.stringify(String(value??"").split("\n").map(line=>line.trim()).filter(Boolean).map(line=>{const [label,...rest]=line.split(":");return {label:label.trim(),value:rest.join(":").trim()};}));
}

function clientPayload(payload: Payload) {
  return {
    name: required(payload, "name"),
    email: required(payload, "email"),
    phone: String(payload.phone ?? ""),
    address: String(payload.address ?? ""),
    country: String(payload.country ?? ""),
    website: String(payload.website ?? ""),
    directorCeoName: String(payload.directorCeoName ?? ""),
    directorPhone: String(payload.directorPhone ?? ""),
    directorEmail: String(payload.directorEmail ?? ""),
    inn: String(payload.inn ?? ""),
    kpp: String(payload.kpp ?? ""),
    ogrn: String(payload.ogrn ?? ""),
    contactPerson: String(payload.contactPerson ?? ""),
    contactPosition: String(payload.contactPosition ?? ""),
    contactEmail: String(payload.contactEmail ?? ""),
    contactTel: String(payload.contactTel ?? ""),
    contactMob: String(payload.contactMob ?? ""),
    beneficiaryName: String(payload.beneficiaryName ?? ""),
    bankName: String(payload.bankName ?? ""),
    bankAccountNumber: String(payload.bankAccountNumber ?? ""),
    bankAddress: String(payload.bankAddress ?? ""),
    currency: String(payload.currency ?? "RUB"),
    swiftCode: String(payload.swiftCode ?? ""),
    ifscCode: String(payload.ifscCode ?? ""),
    commissionEarned: Number(payload.commissionEarned ?? 0),
    kind: String(payload.kind ?? "customer"),
  };
}

const CLIENT_INSERT_SQL = `INSERT INTO clients (
  name,email,phone,address,country,website,director_ceo_name,director_phone,director_email,inn,kpp,ogrn,
  contact_person,contact_position,contact_email,contact_tel,contact_mob,
  beneficiary_name,bank_name,bank_account_number,bank_address,currency,swift_code,ifsc_code,commission_earned,kind
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`;

const CLIENT_UPDATE_SQL = `UPDATE clients SET
  name=?,email=?,phone=?,address=?,country=?,website=?,director_ceo_name=?,director_phone=?,director_email=?,inn=?,kpp=?,ogrn=?,
  contact_person=?,contact_position=?,contact_email=?,contact_tel=?,contact_mob=?,
  beneficiary_name=?,bank_name=?,bank_account_number=?,bank_address=?,currency=?,swift_code=?,ifsc_code=?,commission_earned=?,kind=?
WHERE id=?`;

function clientBindValues(values: ReturnType<typeof clientPayload>) {
  return [
    values.name, values.email, values.phone, values.address, values.country, values.website,
    values.directorCeoName, values.directorPhone, values.directorEmail, values.inn, values.kpp, values.ogrn,
    values.contactPerson, values.contactPosition, values.contactEmail, values.contactTel, values.contactMob,
    values.beneficiaryName, values.bankName, values.bankAccountNumber, values.bankAddress,
    values.currency, values.swiftCode, values.ifscCode, values.commissionEarned, values.kind,
  ];
}

export async function GET(request: Request) {
  try { await prepareDatabase(); const actor = await authenticate(request); return Response.json(await snapshot(actor)); }
  catch (error) { const message=error instanceof Error?error.message:"Unable to load workspace";const status=message==="AUTH_REQUIRED"?401:message==="SEAT_REQUIRED"||message==="ACCOUNT_DISABLED"?403:500;return Response.json({ error: message }, { status }); }
}

export async function POST(request: Request) {
  try {
    await prepareDatabase();
    const actor = await authenticate(request);
    const payload = await request.json() as Payload;
    const db = database();
    if (actor.role === "operator" && ["user","user-edit","user-status","user-password-reset","user-password-set","client","client-edit","party-link","party-unlink","client-assign","client-unassign","clear-business-data","bank","exchange-rate","delete","invoice-template","invoice-template-edit","invoice-edit"].includes(String(payload.action))) return Response.json({error:"Level 2 operators cannot change protected master, templates, or access data"},{status:403});
    if(payload.action==="settings"){
      const displayName=String(payload.displayName??"").trim();
      const language=String(payload.language??"en");
      const defaultView=String(payload.defaultView??"overview");
      const dateFormat=String(payload.dateFormat??"DD/MM/YYYY");
      const timeFormat=String(payload.timeFormat??"24h");
      const timezone=String(payload.timezone??"UTC");
      const numberLocale=String(payload.numberLocale??"en-US");
      const reportingCurrency=currencyCode(payload.reportingCurrency,"RUB");
      const defaultInvoiceCurrency=currencyCode(payload.defaultInvoiceCurrency,"RUB");
      const defaultOrderCurrency=currencyCode(payload.defaultOrderCurrency,"RUB");
      const compactMode=Boolean(payload.compactMode);
      const showTimestamps=payload.showTimestamps!==false;
      if(displayName.length<2)throw new Error("Display name must be at least 2 characters");
      if(!VALID_LANGUAGES.has(language))throw new Error("Unsupported language preference");
      if(!VALID_VIEWS.has(defaultView))throw new Error("Unsupported default page");
      if(actor.role==="operator"&&defaultView==="activity")throw new Error("Level 2 operators cannot set Activity history as their default page");
      if(!VALID_DATE_FORMATS.has(dateFormat))throw new Error("Unsupported date format");
      if(!VALID_TIME_FORMATS.has(timeFormat))throw new Error("Unsupported time format");
      if(!VALID_TIMEZONES.has(timezone))throw new Error("Unsupported timezone");
      if(!VALID_NUMBER_LOCALES.has(numberLocale))throw new Error("Unsupported number format");
      await db.prepare("UPDATE app_users SET display_name=?,language=?,default_view=?,date_format=?,compact_mode=?,reporting_currency=?,time_format=?,timezone=?,number_locale=?,default_invoice_currency=?,default_order_currency=?,show_timestamps=? WHERE id=?").bind(displayName,language,defaultView,dateFormat,compactMode?1:0,reportingCurrency,timeFormat,timezone,numberLocale,defaultInvoiceCurrency,defaultOrderCurrency,showTimestamps?1:0,actor.id).run();
      actor.displayName=displayName;actor.language=language;actor.defaultView=defaultView;actor.dateFormat=dateFormat;actor.compactMode=compactMode;actor.reportingCurrency=reportingCurrency;actor.timeFormat=timeFormat as Actor["timeFormat"];actor.timezone=timezone;actor.numberLocale=numberLocale;actor.defaultInvoiceCurrency=defaultInvoiceCurrency;actor.defaultOrderCurrency=defaultOrderCurrency;actor.showTimestamps=showTimestamps;
      await audit(actor,"updated","preferences",actor.id,`${actor.displayName} updated personal preferences`,{displayName,language,defaultView,dateFormat,compactMode,reportingCurrency,timeFormat,timezone,numberLocale,defaultInvoiceCurrency,defaultOrderCurrency,showTimestamps});
    } else if (payload.action === "change-password") {
      const currentPassword=String(payload.currentPassword??"");
      const newPassword=String(payload.newPassword??"");
      const confirmPassword=String(payload.confirmPassword??"");
      if(!currentPassword||!newPassword)throw new Error("Current and new password are required");
      if(newPassword!==confirmPassword)throw new Error("New passwords do not match");
      await changePassword(actor.id,currentPassword,newPassword);
      await audit(actor,"updated","security",actor.id,`${actor.displayName} changed their password`,{});
    } else if (payload.action === "delete") {
      const entityType=String(payload.entityType);const entityId=Number(payload.entityId);let outcome="deleted";let label=entityType;
      if(entityType==="client"){
        const record=await db.prepare("SELECT name FROM clients WHERE id=? AND is_active=1").bind(entityId).first<{name:string}>();if(!record)throw new Error("Client not found");label=record.name;
        const linked=await db.prepare("SELECT (SELECT COUNT(*) FROM invoices WHERE client_id=?)+(SELECT COUNT(*) FROM orders WHERE client_id=? OR supplier_id=?)+(SELECT COUNT(*) FROM payments WHERE client_id=?)+(SELECT COUNT(*) FROM documents WHERE client_id=?) AS count").bind(entityId,entityId,entityId,entityId,entityId).first<{count:number}>();
        if(Number(linked?.count??0)>0){await db.prepare("UPDATE clients SET is_active=0 WHERE id=?").bind(entityId).run();outcome="archived";}else{await db.prepare("DELETE FROM client_supplier_links WHERE client_id=? OR supplier_id=?").bind(entityId,entityId).run();await db.prepare("DELETE FROM clients WHERE id=?").bind(entityId).run();}
      }else if(entityType==="bank"){
        const record=await db.prepare("SELECT nickname FROM bank_accounts WHERE id=? AND is_active=1").bind(entityId).first<{nickname:string}>();if(!record)throw new Error("Bank account not found");label=record.nickname;
        const linked=await db.prepare("SELECT (SELECT COUNT(*) FROM invoices WHERE bank_account_id=?)+(SELECT COUNT(*) FROM payments WHERE bank_account_id=?) AS count").bind(entityId,entityId).first<{count:number}>();
        if(Number(linked?.count??0)>0){await db.prepare("UPDATE bank_accounts SET is_active=0,is_default=0 WHERE id=?").bind(entityId).run();outcome="archived";}else await db.prepare("DELETE FROM bank_accounts WHERE id=?").bind(entityId).run();
      }else if(entityType==="exchange-rate"){
        const record=await db.prepare("SELECT base_currency,quote_currency FROM exchange_rates WHERE id=?").bind(entityId).first<Record<string,unknown>>();if(!record)throw new Error("Exchange rate not found");label=`${record.base_currency}/${record.quote_currency}`;await db.prepare("DELETE FROM exchange_rates WHERE id=?").bind(entityId).run();
      }else if(entityType==="shipment"){
        const record=await db.prepare("SELECT shipment_no,order_id FROM shipments WHERE id=?").bind(entityId).first<{shipment_no:string;order_id:number}>();if(!record)throw new Error("Shipment not found");label=record.shipment_no;
        const order=await db.prepare("SELECT client_id FROM orders WHERE id=?").bind(record.order_id).first<{client_id:number}>();if(order)await assertOperatorClientAccess(db,actor,Number(order.client_id));
        await db.prepare("DELETE FROM shipments WHERE id=?").bind(entityId).run();
      }else if(entityType==="order"){
        const record=await db.prepare("SELECT order_no,client_id FROM orders WHERE id=?").bind(entityId).first<{order_no:string;client_id:number}>();if(!record)throw new Error("Order not found");label=record.order_no;
        await assertOperatorClientAccess(db,actor,Number(record.client_id));
        const invoiceCount=await db.prepare("SELECT COUNT(*) AS count FROM invoices WHERE order_id=?").bind(entityId).first<{count:number}>();
        if(Number(invoiceCount?.count??0)>0){
          await db.prepare("UPDATE orders SET status='Cancelled' WHERE id=?").bind(entityId).run();
          outcome="cancelled";
        }else{
          const docs=await db.prepare("SELECT object_key FROM documents WHERE order_id=?").bind(entityId).all();
          for(const doc of docs.results as Array<{object_key:string}>){try{await deleteObject(String(doc.object_key));}catch{/* stored file may already be gone */}}
          await db.batch([db.prepare("DELETE FROM documents WHERE order_id=?").bind(entityId),db.prepare("DELETE FROM shipments WHERE order_id=?").bind(entityId),db.prepare("DELETE FROM orders WHERE id=?").bind(entityId)]);
        }
      }else if(entityType==="invoice-template"){
        const record=await db.prepare("SELECT name FROM invoice_templates WHERE id=? AND is_active=1").bind(entityId).first<{name:string}>();if(!record)throw new Error("Invoice template not found");label=record.name;await db.prepare("UPDATE invoice_templates SET is_active=0 WHERE id=?").bind(entityId).run();outcome="archived";
      }else if(entityType==="invoice"){
        const record=await db.prepare("SELECT invoice_no,client_id FROM invoices WHERE id=?").bind(entityId).first<{invoice_no:string;client_id:number}>();if(!record)throw new Error("Invoice not found");label=record.invoice_no;
        await assertOperatorClientAccess(db,actor,Number(record.client_id));
        await deleteInvoiceCascade(db,entityId);
      }else throw new Error("This record cannot be deleted");
      await audit(actor,outcome,entityType,entityId,`${actor.displayName} ${outcome} ${label}`,{entityType,label});
    } else if (payload.action === "user") {
      if (actor.role !== "super_admin") return Response.json({error:"Only the Super Admin can assign user seats"},{status:403});
      const count=await db.prepare("SELECT COUNT(*) AS count FROM app_users WHERE status!='disabled'").first<{count:number}>();
      if(Number(count?.count??0)>=MAX_SEATS)throw new Error("All 10 user seats are assigned");
      const email=required(payload,"email").toLowerCase();const role=String(payload.role??"operator");
      if(!["manager","operator"].includes(role))throw new Error("Only Level 1 Manager and Level 2 Operator seats can be assigned");
      const user=await db.prepare("INSERT INTO app_users (platform_user_id,email,display_name,role,status) VALUES (?,?,?,?,'invited') RETURNING id").bind(createPlatformUserId(),email,required(payload,"displayName"),role).first<{id:number}>();
      if(!user)throw new Error("User seat could not be created");
      await audit(actor,"invited","user",user.id,`${actor.displayName} assigned a ${role} seat to ${email}`,{email,role});
    } else if (payload.action === "user-status") {
      if(actor.role!=="super_admin")return Response.json({error:"Only the Super Admin can remove or restore user access"},{status:403});
      const target=await db.prepare("SELECT id,email,display_name,status,role FROM app_users WHERE id=?").bind(Number(payload.userId)).first<Record<string,unknown>>();
      if(!target)throw new Error("User not found");if(Number(target.id)===actor.id)throw new Error("You cannot disable your own administrator seat");
      if(target.role==="super_admin")throw new Error("Super Admin access cannot be changed here");
      const nextStatus=target.status==="disabled"?"invited":"disabled";
      await db.prepare("UPDATE app_users SET status=?, platform_user_id=CASE WHEN ?='disabled' THEN NULL ELSE platform_user_id END WHERE id=?").bind(nextStatus,nextStatus,target.id).run();
      if(nextStatus==="disabled")await db.prepare("DELETE FROM app_sessions WHERE user_id=?").bind(target.id).run();
      await audit(actor,nextStatus==="disabled"?"disabled":"restored","user",String(target.id),`${actor.displayName} ${nextStatus==="disabled"?"disabled":"restored"} access for ${target.email}`,{email:target.email});
    } else if (payload.action === "user-edit") {
      if(actor.role!=="super_admin")return Response.json({error:"Only the Super Admin can edit user access"},{status:403});
      const userId=Number(payload.userId);
      const target=await db.prepare("SELECT id,email,display_name,role,status FROM app_users WHERE id=?").bind(userId).first<Record<string,unknown>>();
      if(!target)throw new Error("User not found");if(Number(target.id)===actor.id)throw new Error("Use Settings to update your own profile");
      if(target.role==="super_admin")throw new Error("Super Admin access cannot be edited here");
      const displayName=String(payload.displayName??"").trim();
      const email=String(payload.email??"").trim().toLowerCase();
      const role=String(payload.role??target.role);
      const status=String(payload.status??target.status);
      if(displayName.length<2)throw new Error("Display name must be at least 2 characters");
      if(!/^\S+@\S+\.\S+$/.test(email))throw new Error("Enter a valid email address");
      if(!["manager","operator"].includes(role))throw new Error("Access level must be Level 1 or Level 2");
      if(!["invited","active","disabled"].includes(status))throw new Error("Invalid access status");
      const duplicate=await db.prepare("SELECT id FROM app_users WHERE lower(email)=? AND id!=?").bind(email,userId).first<{id:number}>();
      if(duplicate)throw new Error("Another user already uses this email");
      await db.prepare("UPDATE app_users SET display_name=?,email=?,role=?,status=?,platform_user_id=CASE WHEN ?='disabled' THEN NULL ELSE platform_user_id END WHERE id=?").bind(displayName,email,role,status,status,userId).run();
      if(status==="disabled")await db.prepare("DELETE FROM app_sessions WHERE user_id=?").bind(userId).run();
      if(target.role==="operator"&&role!=="operator")await db.prepare("DELETE FROM user_client_assignments WHERE user_id=?").bind(userId).run();
      await audit(actor,"updated","user",String(userId),`${actor.displayName} updated access for ${email}`,{before:target,displayName,email,role,status});
    } else if (payload.action === "user-password-reset") {
      if(actor.role!=="super_admin")return Response.json({error:"Only the Super Admin can reset user passwords"},{status:403});
      const target=await db.prepare("SELECT id,email,display_name,role FROM app_users WHERE id=?").bind(Number(payload.userId)).first<Record<string,unknown>>();
      if(!target)throw new Error("User not found");if(Number(target.id)===actor.id)throw new Error("Use Settings to change your own password");
      if(target.role==="super_admin")throw new Error("Super Admin passwords cannot be reset from here");
      await clearUserPassword(Number(target.id));
      await audit(actor,"password reset","user",String(target.id),`${actor.displayName} cleared the password for ${target.email}. They must set a new password on next sign-in.`,{email:target.email});
    } else if (payload.action === "user-password-set") {
      if(actor.role!=="super_admin")return Response.json({error:"Only the Super Admin can set user passwords"},{status:403});
      const target=await db.prepare("SELECT id,email,display_name,role FROM app_users WHERE id=?").bind(Number(payload.userId)).first<Record<string,unknown>>();
      if(!target)throw new Error("User not found");if(Number(target.id)===actor.id)throw new Error("Use Settings to change your own password");
      if(target.role==="super_admin")throw new Error("Super Admin passwords cannot be changed from here");
      const newPassword=String(payload.newPassword??"");
      const confirmPassword=String(payload.confirmPassword??"");
      if(!newPassword)throw new Error("New password is required");
      if(newPassword!==confirmPassword)throw new Error("Passwords do not match");
      await setUserPassword(Number(target.id),newPassword);
      await audit(actor,"password set","user",String(target.id),`${actor.displayName} set a new password for ${target.email}`,{email:target.email});
    } else if (payload.action === "client") {
      const values = clientPayload(payload);
      const client = await db.prepare(CLIENT_INSERT_SQL).bind(...clientBindValues(values)).first<{id:number}>();
      if(client)await audit(actor,"created","client",client.id,`${actor.displayName} created client ${values.name}`,{email:values.email});
    } else if (payload.action === "client-edit") {
      const clientId=Number(payload.clientId);const before=await db.prepare("SELECT * FROM clients WHERE id=?").bind(clientId).first<Record<string,unknown>>();
      if(!before)throw new Error("Client not found");
      const values = clientPayload(payload);
      await db.prepare(CLIENT_UPDATE_SQL).bind(...clientBindValues(values), clientId).run();
      await audit(actor,"updated","client",clientId,`${actor.displayName} updated master data for ${values.name}`,{before,after:values});
    } else if (payload.action === "party-link") {
      const clientId=Number(payload.clientId);const supplierId=Number(payload.supplierId);if(!clientId||!supplierId||clientId===supplierId)throw new Error("Choose a client and supplier");
      const parties=await db.prepare("SELECT id,name,kind FROM clients WHERE id IN (?,?) AND is_active=1").bind(clientId,supplierId).all();if(parties.results.length!==2)throw new Error("Client or supplier not found");
      await db.prepare("INSERT OR IGNORE INTO client_supplier_links (client_id,supplier_id) VALUES (?,?)").bind(clientId,supplierId).run();await audit(actor,"linked","client-supplier",`${clientId}:${supplierId}`,`${actor.displayName} linked a supplier to a client`,{clientId,supplierId});
    } else if (payload.action === "party-unlink") {
      const clientId=Number(payload.clientId);const supplierId=Number(payload.supplierId);await db.prepare("DELETE FROM client_supplier_links WHERE client_id=? AND supplier_id=?").bind(clientId,supplierId).run();await audit(actor,"unlinked","client-supplier",`${clientId}:${supplierId}`,`${actor.displayName} removed a client-supplier link`,{clientId,supplierId});
    } else if (payload.action === "client-assign") {
      if (!canAssignClients(actor)) return Response.json({ error: "Only Super Admin and Level 1 can assign clients to operators" }, { status: 403 });
      const userId = Number(payload.userId);
      const clientId = Number(payload.clientId);
      const operator = await assertAssignableOperator(db, userId);
      const client = await assertAssignableClient(db, clientId);
      await db.prepare("INSERT OR IGNORE INTO user_client_assignments (user_id,client_id,assigned_by) VALUES (?,?,?)").bind(userId, clientId, actor.id).run();
      await audit(actor, "assigned", "user-client", `${userId}:${clientId}`, `${actor.displayName} assigned ${client.name} to ${operator.display_name}`, { userId, clientId, clientName: client.name, operatorName: operator.display_name });
    } else if (payload.action === "client-unassign") {
      if (!canAssignClients(actor)) return Response.json({ error: "Only Super Admin and Level 1 can assign clients to operators" }, { status: 403 });
      const userId = Number(payload.userId);
      const clientId = Number(payload.clientId);
      const operator = await assertAssignableOperator(db, userId);
      const client = await db.prepare("SELECT id,name FROM clients WHERE id=?").bind(clientId).first<{ id: number; name: string }>();
      if (!client) throw new Error("Client not found");
      await db.prepare("DELETE FROM user_client_assignments WHERE user_id=? AND client_id=?").bind(userId, clientId).run();
      await audit(actor, "unassigned", "user-client", `${userId}:${clientId}`, `${actor.displayName} removed ${client.name} from ${operator.display_name}`, { userId, clientId, clientName: client.name, operatorName: operator.display_name });
    } else if (payload.action === "bank") {
      if (payload.isDefault) await db.prepare("UPDATE bank_accounts SET is_default=0").run();
      const bank=await db.prepare("INSERT INTO bank_accounts (nickname,bank_name,currency,account_last4,balance,is_default) VALUES (?,?,?,?,?,?) RETURNING id").bind(required(payload,"nickname"),required(payload,"bankName"),String(payload.currency??"RUB"),required(payload,"accountLast4").slice(-4),Number(payload.balance??0),payload.isDefault?1:0).first<{id:number}>();
      if(bank)await audit(actor,"created","bank account",bank.id,`${actor.displayName} added bank account ${payload.nickname}`,{bankName:payload.bankName,currency:payload.currency,isDefault:Boolean(payload.isDefault)});
    } else if (payload.action === "exchange-rate") {
      const rate=Number(payload.rate);if(!Number.isFinite(rate)||rate<=0)throw new Error("Exchange rate must be greater than zero");
      const record=await db.prepare("INSERT INTO exchange_rates (base_currency,quote_currency,rate,effective_date,created_by) VALUES (?,?,?,?,?) RETURNING id").bind(required(payload,"baseCurrency").toUpperCase(),required(payload,"quoteCurrency").toUpperCase(),rate,required(payload,"effectiveDate"),actor.id).first<{id:number}>();
      if(record)await audit(actor,"created","exchange rate",record.id,`${actor.displayName} set ${payload.baseCurrency}/${payload.quoteCurrency} to ${rate}`,{baseCurrency:payload.baseCurrency,quoteCurrency:payload.quoteCurrency,rate,effectiveDate:payload.effectiveDate});
    } else if (payload.action === "status") {
      const entityType=String(payload.entityType);const entityId=Number(payload.entityId);const status=required(payload,"status");
      const allowed:Record<string,{table:string,label:string,clientColumn?:string}>={order:{table:"orders",label:"order",clientColumn:"client_id"},shipment:{table:"shipments",label:"shipment"},invoice:{table:"invoices",label:"invoice",clientColumn:"client_id"}};
      const target=allowed[entityType];if(!target)throw new Error("This record status cannot be changed");
      const before=await db.prepare(`SELECT status${target.clientColumn?`,${target.clientColumn}`:""} FROM ${target.table} WHERE id=?`).bind(entityId).first<{status:string;client_id?:number}>();
      if(!before)throw new Error("Record not found");
      if(target.clientColumn&&before.client_id!=null)await assertOperatorClientAccess(db,actor,Number(before.client_id));
      if(entityType==="shipment"){const shipment=await db.prepare("SELECT o.client_id FROM shipments s JOIN orders o ON o.id=s.order_id WHERE s.id=?").bind(entityId).first<{client_id:number}>();if(shipment)await assertOperatorClientAccess(db,actor,Number(shipment.client_id));}
      await db.prepare(`UPDATE ${target.table} SET status=? WHERE id=?`).bind(status,entityId).run();
      await audit(actor,"status changed",target.label,entityId,`${actor.displayName} changed ${target.label} status from ${before.status} to ${status}`,{before:before.status,after:status});
    } else if (payload.action === "order") {
      const clientId=Number(payload.clientId);
      await assertOperatorClientAccess(db,actor,clientId);
      const orderNo = await nextPrefixedNumber(db, "orders", "order_no", "ORD-", 1);
      const salePrice=Number(payload.salePrice??0);const purchasePrice=Number(payload.purchasePrice??0);const commission=Number(payload.commissionPercent??0);
      if(!Number.isFinite(commission)||commission<0||commission>100)throw new Error("Commission percentage must be between 0 and 100");
      const order=await db.prepare("INSERT INTO orders (order_no,client_id,supplier_id,description,amount,currency,purchase_price,sale_price,commission_percent,purchase_currency,sale_currency,purchase_invoice_details,sales_invoice_details,status,expected_date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id").bind(orderNo,Number(payload.clientId),payload.supplierId?Number(payload.supplierId):null,required(payload,"description"),salePrice,String(payload.saleCurrency??"RUB"),purchasePrice,salePrice,commission,String(payload.purchaseCurrency??"RUB"),String(payload.saleCurrency??"RUB"),String(payload.purchaseInvoiceDetails??""),String(payload.salesInvoiceDetails??""),String(payload.status??"Confirmed"),String(payload.expectedDate??"")||null).first<{id:number}>();
      if(order)await audit(actor,"created","order",order.id,`${actor.displayName} created order ${orderNo}`,{clientId:payload.clientId,supplierId:payload.supplierId,purchasePrice,salePrice,commission});
    } else if (payload.action === "order-edit") {
      const orderId=Number(payload.orderId);const before=await db.prepare("SELECT * FROM orders WHERE id=?").bind(orderId).first<Record<string,unknown>>();if(!before)throw new Error("Order not found");
      await assertOperatorClientAccess(db,actor,Number(before.client_id));
      const nextClientId=Number(payload.clientId);
      if(nextClientId!==Number(before.client_id))await assertOperatorClientAccess(db,actor,nextClientId);
      const salePrice=Number(payload.salePrice??0);const purchasePrice=Number(payload.purchasePrice??0);const commission=Number(payload.commissionPercent??0);if(!Number.isFinite(commission)||commission<0||commission>100)throw new Error("Commission percentage must be between 0 and 100");
      await db.prepare("UPDATE orders SET client_id=?,supplier_id=?,description=?,amount=?,currency=?,purchase_price=?,sale_price=?,commission_percent=?,purchase_currency=?,sale_currency=?,purchase_invoice_details=?,sales_invoice_details=?,status=?,expected_date=? WHERE id=?").bind(Number(payload.clientId),payload.supplierId?Number(payload.supplierId):null,required(payload,"description"),salePrice,String(payload.saleCurrency??"RUB"),purchasePrice,salePrice,commission,String(payload.purchaseCurrency??"RUB"),String(payload.saleCurrency??"RUB"),String(payload.purchaseInvoiceDetails??""),String(payload.salesInvoiceDetails??""),String(payload.status??"Confirmed"),String(payload.expectedDate??"")||null,orderId).run();
      await audit(actor,"updated","order",orderId,`${actor.displayName} updated order ${before.order_no}`,{before,supplierId:payload.supplierId,purchasePrice,salePrice,commission});
    } else if (payload.action === "shipment") {
      const order=await db.prepare("SELECT client_id FROM orders WHERE id=?").bind(Number(payload.orderId)).first<{client_id:number}>();if(!order)throw new Error("Choose a valid order");
      await assertOperatorClientAccess(db,actor,Number(order.client_id));
      const shipmentNo = await nextPrefixedNumber(db, "shipments", "shipment_no", "SHP-", 1);
      const shipment=await db.prepare("INSERT INTO shipments (shipment_no,order_id,carrier,tracking_no,status,eta) VALUES (?,?,?,?,?,?) RETURNING id").bind(shipmentNo,Number(payload.orderId),required(payload,"carrier"),String(payload.trackingNo??""),String(payload.status??"Preparing"),String(payload.eta??"")||null).first<{id:number}>();
      if(shipment)await audit(actor,"created","shipment",shipment.id,`${actor.displayName} created shipment ${shipmentNo}`,{orderId:payload.orderId,carrier:payload.carrier,trackingNo:payload.trackingNo,status:payload.status});
    } else if(payload.action==="invoice-template"||payload.action==="invoice-template-edit"){
      if(actor.role==="operator")return Response.json({error:"Only the Super Admin and Level 1 can manage invoice templates"},{status:403});
      const values=[required(payload,"templateName"),String(payload.direction??"sale"),required(payload,"numberPrefix").toUpperCase().replace(/[^A-Z0-9-]/g,"").slice(0,12),required(payload,"title"),String(payload.headerText??""),String(payload.headerImageUrl??""),required(payload,"sellerName"),String(payload.sellerAddress??""),String(payload.sellerEmail??""),String(payload.sellerPhone??""),String(payload.taxRegistration??""),String(payload.bankDetails??""),String(payload.paymentTerms??""),String(payload.footer??""),String(payload.footerImageUrl??""),/^#[0-9a-f]{6}$/i.test(String(payload.accentColor))?String(payload.accentColor):"#176f8f",customFields(payload.customFields)];
      if(payload.action==="invoice-template"){
        const record=await db.prepare("INSERT INTO invoice_templates (name,direction,number_prefix,title,header_text,header_image_url,seller_name,seller_address,seller_email,seller_phone,tax_registration,bank_details,payment_terms,footer,footer_image_url,accent_color,custom_fields_json,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id").bind(...values,actor.id).first<{id:number}>();
        if(!record)throw new Error("Invoice template could not be created");await audit(actor,"created","invoice-template",record.id,`${actor.displayName} created invoice template ${payload.templateName}`,{name:payload.templateName,direction:payload.direction});
      }else{
        const templateId=Number(payload.templateId);const before=await db.prepare("SELECT * FROM invoice_templates WHERE id=? AND is_active=1").bind(templateId).first<Record<string,unknown>>();if(!before)throw new Error("Invoice template not found");
        await db.prepare("UPDATE invoice_templates SET name=?,direction=?,number_prefix=?,title=?,header_text=?,header_image_url=?,seller_name=?,seller_address=?,seller_email=?,seller_phone=?,tax_registration=?,bank_details=?,payment_terms=?,footer=?,footer_image_url=?,accent_color=?,custom_fields_json=? WHERE id=?").bind(...values,templateId).run();
        await audit(actor,"updated","invoice-template",templateId,`${actor.displayName} updated invoice template ${payload.templateName}`,{before,name:payload.templateName});
      }
    } else if (payload.action === "invoice"||payload.action === "invoice-edit") {
      const order=await db.prepare("SELECT id,client_id,description,sale_price,sale_currency,purchase_price,purchase_currency FROM orders WHERE id=?").bind(Number(payload.orderId)).first<Record<string,unknown>>();if(!order)throw new Error("Choose a valid order");
      await assertOperatorClientAccess(db,actor,Number(order.client_id));
      const template=await db.prepare("SELECT * FROM invoice_templates WHERE id=? AND is_active=1").bind(Number(payload.templateId)).first<Record<string,unknown>>();if(!template)throw new Error("Choose an invoice template");
      const direction=String(template.direction)==="purchase"?"purchase":"sale";
      const lines=parseLineItems(payload);const subtotal=lineItemsSubtotal(lines);const taxRate=Number(payload.taxRate??0);const taxAmount=subtotal*taxRate/100;const discount=Number(payload.discountAmount??0);const shipping=Number(payload.shippingAmount??0);const total=subtotal+taxAmount-discount+shipping;
      if(!Number.isFinite(total)||total<=0)throw new Error("Invoice total must be greater than zero");if(taxRate<0||taxRate>100)throw new Error("Tax rate must be between 0 and 100");
      const clientId=Number(order.client_id);const templateSnapshot=JSON.stringify(template);
      if(payload.action==="invoice"){
        const invoiceNo=await nextInvoiceNumber(db,String(template.number_prefix));
        const invoice=await db.prepare("INSERT INTO invoices (invoice_no,client_id,bank_account_id,order_id,template_id,direction,issue_date,due_date,currency,subtotal,tax_rate,tax_amount,discount_amount,shipping_amount,total,reference,status,notes,template_snapshot) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id").bind(invoiceNo,clientId,Number(payload.bankAccountId),order.id,template.id,direction,required(payload,"issueDate"),required(payload,"dueDate"),String(payload.currency??"RUB"),subtotal,taxRate,taxAmount,discount,shipping,total,String(payload.reference??""),"Sent",String(payload.notes??""),templateSnapshot).first<{id:number}>();
        if(!invoice)throw new Error("Invoice could not be created");await saveInvoiceItems(db,invoice.id,lines);
        const entry=await db.prepare("INSERT INTO journal_entries (entry_date,reference_type,reference_id,memo) VALUES (?,?,?,?) RETURNING id").bind(required(payload,"issueDate"),direction==="sale"?"invoice":"bill",invoice.id,`${direction==="sale"?"Sale":"Purchase"}: ${invoiceNo}`).first<{id:number}>();if(!entry)throw new Error("Journal entry could not be created");
        await db.batch(direction==="sale"?[db.prepare("INSERT INTO journal_lines (entry_id,account_code,account_name,debit,credit,client_id) VALUES (?,?,?,?,?,?)").bind(entry.id,"1100","Accounts receivable",total,0,clientId),db.prepare("INSERT INTO journal_lines (entry_id,account_code,account_name,debit,credit,client_id) VALUES (?,?,?,?,?,?)").bind(entry.id,"4000","Sales invoices",0,total,clientId)]:[db.prepare("INSERT INTO journal_lines (entry_id,account_code,account_name,debit,credit,client_id) VALUES (?,?,?,?,?,?)").bind(entry.id,"5000","Purchase bills",total,0,clientId),db.prepare("INSERT INTO journal_lines (entry_id,account_code,account_name,debit,credit,client_id) VALUES (?,?,?,?,?,?)").bind(entry.id,"2000","Accounts payable",0,total,clientId)]);
        await audit(actor,"created",direction==="sale"?"invoice":"bill",invoice.id,`${actor.displayName} generated ${invoiceNo} for order ${order.id}`,{clientId,orderId:order.id,templateId:template.id,total,currency:payload.currency});
      }else{
        if(actor.role==="operator")return Response.json({error:"Only the Super Admin and Level 1 can edit invoices"},{status:403});const invoiceId=Number(payload.invoiceId);const before=await db.prepare("SELECT * FROM invoices WHERE id=?").bind(invoiceId).first<Record<string,unknown>>();if(!before)throw new Error("Invoice not found");if(String(before.status)==="Paid")throw new Error("Paid invoices cannot be edited");
        await db.prepare("UPDATE invoices SET client_id=?,bank_account_id=?,order_id=?,template_id=?,direction=?,issue_date=?,due_date=?,currency=?,subtotal=?,tax_rate=?,tax_amount=?,discount_amount=?,shipping_amount=?,total=?,reference=?,notes=?,template_snapshot=? WHERE id=?").bind(clientId,Number(payload.bankAccountId),order.id,template.id,direction,required(payload,"issueDate"),required(payload,"dueDate"),String(payload.currency??"RUB"),subtotal,taxRate,taxAmount,discount,shipping,total,String(payload.reference??""),String(payload.notes??""),templateSnapshot,invoiceId).run();await saveInvoiceItems(db,invoiceId,lines);
        const entry=await db.prepare("SELECT id FROM journal_entries WHERE reference_type IN ('invoice','bill') AND reference_id=? LIMIT 1").bind(invoiceId).first<{id:number}>();if(entry){await db.prepare("UPDATE journal_entries SET entry_date=?,reference_type=?,memo=? WHERE id=?").bind(required(payload,"issueDate"),direction==="sale"?"invoice":"bill",`${direction==="sale"?"Sale":"Purchase"}: ${before.invoice_no}`,entry.id).run();await db.prepare("DELETE FROM journal_lines WHERE entry_id=?").bind(entry.id).run();await db.batch(direction==="sale"?[db.prepare("INSERT INTO journal_lines (entry_id,account_code,account_name,debit,credit,client_id) VALUES (?,?,?,?,?,?)").bind(entry.id,"1100","Accounts receivable",total,0,clientId),db.prepare("INSERT INTO journal_lines (entry_id,account_code,account_name,debit,credit,client_id) VALUES (?,?,?,?,?,?)").bind(entry.id,"4000","Sales invoices",0,total,clientId)]:[db.prepare("INSERT INTO journal_lines (entry_id,account_code,account_name,debit,credit,client_id) VALUES (?,?,?,?,?,?)").bind(entry.id,"5000","Purchase bills",total,0,clientId),db.prepare("INSERT INTO journal_lines (entry_id,account_code,account_name,debit,credit,client_id) VALUES (?,?,?,?,?,?)").bind(entry.id,"2000","Accounts payable",0,total,clientId)]);}
        await audit(actor,"updated","invoice",invoiceId,`${actor.displayName} edited invoice ${before.invoice_no}`,{before,total,orderId:order.id,templateId:template.id});
      }
    } else if (payload.action === "payment") {
      const invoice = await db.prepare("SELECT * FROM invoices WHERE id=?").bind(Number(payload.invoiceId)).first<Record<string,unknown>>();
      if (!invoice) throw new Error("Invoice not found");
      await assertOperatorClientAccess(db, actor, Number(invoice.client_id));
      if (String(invoice.status) === "Paid") throw new Error("This invoice is already paid");
      if (String(invoice.status) === "Cancelled") throw new Error("Cancelled invoices cannot receive payments");
      const amount = Number(payload.amount??invoice.total);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Payment amount must be greater than zero");
      const paidRow = await db.prepare("SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE invoice_id=?").bind(invoice.id).first<{paid:number}>();
      const remaining = Number(invoice.total) - Number(paidRow?.paid ?? 0);
      if (remaining <= 0) throw new Error("This invoice has no remaining balance");
      if (amount > remaining + 0.001) throw new Error(`Payment cannot exceed the remaining balance of ${remaining.toFixed(2)}`);
      const direction = invoice.direction === "purchase" ? "out" : "in";
      await db.prepare("INSERT INTO payments (invoice_id,client_id,bank_account_id,direction,amount,payment_date,reference) VALUES (?,?,?,?,?,?,?)").bind(invoice.id,invoice.client_id,invoice.bank_account_id,direction,amount,required(payload,"paymentDate"),String(payload.reference??"")).run();
      await db.prepare(`UPDATE bank_accounts SET balance=balance ${direction === "in" ? "+" : "-"} ? WHERE id=?`).bind(amount,invoice.bank_account_id).run();
      await db.prepare("UPDATE invoices SET status=CASE WHEN (SELECT COALESCE(SUM(amount),0) FROM payments WHERE invoice_id=?) >= total THEN 'Paid' ELSE 'Part paid' END WHERE id=?").bind(invoice.id,invoice.id).run();
      const entry = await db.prepare("INSERT INTO journal_entries (entry_date,reference_type,reference_id,memo) VALUES (?,?,?,?) RETURNING id").bind(required(payload,"paymentDate"),"payment",invoice.id,`${direction === "in" ? "Receipt" : "Payment"}: ${invoice.invoice_no}`).first<{id:number}>();
      if (entry) await db.batch(direction === "in" ? [
        db.prepare("INSERT INTO journal_lines (entry_id,account_code,account_name,debit,credit,client_id) VALUES (?,?,?,?,?,?)").bind(entry.id,"1000","Bank accounts",amount,0,invoice.client_id),
        db.prepare("INSERT INTO journal_lines (entry_id,account_code,account_name,debit,credit,client_id) VALUES (?,?,?,?,?,?)").bind(entry.id,"1100","Accounts receivable",0,amount,invoice.client_id),
      ] : [
        db.prepare("INSERT INTO journal_lines (entry_id,account_code,account_name,debit,credit,client_id) VALUES (?,?,?,?,?,?)").bind(entry.id,"2000","Accounts payable",amount,0,invoice.client_id),
        db.prepare("INSERT INTO journal_lines (entry_id,account_code,account_name,debit,credit,client_id) VALUES (?,?,?,?,?,?)").bind(entry.id,"1000","Bank accounts",0,amount,invoice.client_id),
      ]);
      await audit(actor,"recorded","payment",String(invoice.id),`${actor.displayName} recorded ${direction==="in"?"receipt":"payment"} for ${invoice.invoice_no}`,{invoiceId:invoice.id,amount,direction,reference:payload.reference});
    } else if (payload.action === "clear-business-data") {
      if (actor.role !== "super_admin") return Response.json({ error: "Only the Super Admin can clear all business data" }, { status: 403 });
      if (String(payload.confirm ?? "") !== "RESET") throw new Error('Type RESET in the confirmation field to clear all business data');
      const summary = await clearBusinessData();
      await audit(actor, "cleared", "workspace", actor.id, `${actor.displayName} cleared all business data for a fresh start`, summary);
    } else throw new Error("Unknown action");
    return Response.json(await snapshot(actor), { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to save record" }, { status: 400 }); }
}
