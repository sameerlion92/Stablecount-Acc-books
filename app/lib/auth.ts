import { compare, hash } from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { logAudit } from "./audit";
import { database } from "./database";
import { sendPasswordResetEmail } from "./mail";

const SESSION_COOKIE = "stablecount_session";
const SESSION_DAYS = 14;
const RESET_HOURS = 1;

export type SessionIdentity = {
  userId: string;
  email: string;
  displayName: string;
  fullName: string;
};

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const platformUserId = () => `vercel:${randomUUID()}`;
export const createPlatformUserId = platformUserId;

export async function ensureAuthSchema() {
  const db = database();
  await db.prepare(`CREATE TABLE IF NOT EXISTS app_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform_user_id TEXT UNIQUE,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'operator',
    status TEXT NOT NULL DEFAULT 'invited',
    language TEXT NOT NULL DEFAULT 'en',
    default_view TEXT NOT NULL DEFAULT 'overview',
    date_format TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
    compact_mode INTEGER NOT NULL DEFAULT 0,
    last_seen_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  const columns = await db.prepare("PRAGMA table_info(app_users)").all();
  if (!columns.results.some((column) => String(column.name) === "password_hash")) {
    await db.prepare("ALTER TABLE app_users ADD COLUMN password_hash TEXT").run();
  }
  await db.prepare(`CREATE TABLE IF NOT EXISTS app_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_app_sessions_token ON app_sessions(token_hash)").run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens(token_hash)").run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES app_users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    description TEXT NOT NULL,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id)").run();
  const brokenPlatformIds = await db.prepare("SELECT id FROM app_users WHERE platform_user_id IS NULL OR platform_user_id='null'").all();
  for (const row of brokenPlatformIds.results as Array<{ id: number }>) {
    await db.prepare("UPDATE app_users SET platform_user_id=? WHERE id=?").bind(platformUserId(), row.id).run();
  }
}

export async function hasRegisteredUsers() {
  await ensureAuthSchema();
  const row = await database().prepare("SELECT COUNT(*) AS count FROM app_users WHERE status!='disabled'").first<{ count: number }>();
  return Number(row?.count ?? 0) > 0;
}

export async function getSessionIdentity(): Promise<SessionIdentity | null> {
  await ensureAuthSchema();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = await database().prepare(`SELECT u.platform_user_id,u.email,u.display_name,u.status
    FROM app_sessions s JOIN app_users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP LIMIT 1`).bind(digest(token)).first<Record<string, unknown>>();
  if (!row || row.status === "disabled") return null;
  const storedUserId = row.platform_user_id ? String(row.platform_user_id) : null;
  return {
    userId: storedUserId ?? `email:${String(row.email).trim().toLowerCase()}`,
    email: String(row.email),
    displayName: String(row.display_name),
    fullName: String(row.display_name),
  };
}

export async function signInWithPassword(input: { email: string; password: string; displayName?: string }) {
  await ensureAuthSchema();
  const db = database();
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a valid email address");
  if (password.length < 10) throw new Error("Password must be at least 10 characters");

  const count = await db.prepare("SELECT COUNT(*) AS count FROM app_users WHERE status!='disabled'").first<{ count: number }>();
  let user = await db.prepare("SELECT id,email,display_name,password_hash,status,platform_user_id FROM app_users WHERE lower(email)=? LIMIT 1").bind(email).first<Record<string, unknown>>();

  if (Number(count?.count ?? 0) === 0) {
    const displayName = input.displayName?.trim();
    if (!displayName) throw new Error("Enter the Super Admin's name");
    const passwordHash = await hash(password, 12);
    user = await db.prepare(`INSERT INTO app_users
      (platform_user_id,email,display_name,password_hash,role,status,last_seen_at)
      VALUES (?,?,?,?, 'super_admin','active',CURRENT_TIMESTAMP)
      RETURNING id,email,display_name,password_hash,status`).bind(`vercel:${randomUUID()}`, email, displayName, passwordHash).first<Record<string, unknown>>();
    if (user) await logAudit(Number(user.id), "activated", "user", Number(user.id), `${displayName} created the Super Admin account`, { email, role: "super_admin" });
  } else {
    if (!user) throw new Error("This email does not have a Stablecount user seat");
    if (user.status === "disabled") throw new Error("This user seat has been disabled");
    if (!user.password_hash) {
      if (user.status !== "invited") throw new Error("Password setup is unavailable for this account");
      const passwordHash = await hash(password, 12);
      const nextPlatformUserId = user.platform_user_id ? String(user.platform_user_id) : platformUserId();
      await db.prepare("UPDATE app_users SET password_hash=?,platform_user_id=?,status='active',last_seen_at=CURRENT_TIMESTAMP WHERE id=?").bind(passwordHash, nextPlatformUserId, user.id).run();
      user.password_hash = passwordHash;
      user.platform_user_id = nextPlatformUserId;
      await logAudit(Number(user.id), "activated", "user", Number(user.id), `${String(user.display_name)} completed password setup and signed in`, { email });
    } else if (!(await compare(password, String(user.password_hash)))) {
      throw new Error("Incorrect email or password");
    } else if (!user.platform_user_id || user.platform_user_id === "null") {
      const nextPlatformUserId = platformUserId();
      await db.prepare("UPDATE app_users SET platform_user_id=? WHERE id=?").bind(nextPlatformUserId, user.id).run();
      user.platform_user_id = nextPlatformUserId;
    }
  }

  if (!user) throw new Error("Unable to create the user session");
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await db.prepare("DELETE FROM app_sessions WHERE expires_at<=CURRENT_TIMESTAMP").run();
  await db.prepare("INSERT INTO app_sessions (user_id,token_hash,expires_at) VALUES (?,?,?)").bind(user.id, digest(token), expiresAt.toISOString()).run();
  await db.prepare("UPDATE app_users SET last_seen_at=CURRENT_TIMESTAMP WHERE id=?").bind(user.id).run();
  await logAudit(Number(user.id), "signed in", "session", Number(user.id), `${String(user.display_name)} signed in`, { email });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function signOut() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await ensureAuthSchema();
    const db = database();
    const row = await db.prepare(`SELECT u.id,u.display_name FROM app_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=? LIMIT 1`).bind(digest(token)).first<{ id: number; display_name: string }>();
    await db.prepare("DELETE FROM app_sessions WHERE token_hash=?").bind(digest(token)).run();
    if (row) await logAudit(row.id, "signed out", "session", row.id, `${row.display_name} signed out`, {});
  }
  store.delete(SESSION_COOKIE);
}

export async function requestPasswordReset(email: string) {
  await ensureAuthSchema();
  const normalized = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalized)) throw new Error("Enter a valid email address");

  const user = await database().prepare("SELECT id,email,display_name,status FROM app_users WHERE lower(email)=? LIMIT 1").bind(normalized).first<Record<string, unknown>>();
  if (!user || user.status === "disabled") return null;

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_HOURS * 3600000);
  const db = database();
  await db.prepare("DELETE FROM password_reset_tokens WHERE user_id=? OR expires_at<=CURRENT_TIMESTAMP").bind(user.id).run();
  await db.prepare("INSERT INTO password_reset_tokens (user_id,token_hash,expires_at) VALUES (?,?,?)").bind(user.id, digest(token), expiresAt.toISOString()).run();
  await logAudit(Number(user.id), "requested", "password-reset", Number(user.id), `Password reset requested for ${normalized}`, { email: normalized });
  return {
    token,
    email: String(user.email),
    displayName: String(user.display_name),
  };
}

export async function deliverPasswordReset(email: string, origin: string) {
  const reset = await requestPasswordReset(email);
  if (!reset) return false;
  const resetUrl = `${origin.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(reset.token)}`;
  await sendPasswordResetEmail({
    to: reset.email,
    displayName: reset.displayName,
    resetUrl,
  });
  return true;
}

export async function resetPasswordWithToken(input: { token: string; password: string }) {
  await ensureAuthSchema();
  const password = input.password;
  if (password.length < 10) throw new Error("Password must be at least 10 characters");

  const row = await database().prepare(`SELECT t.user_id,u.email,u.display_name,u.status
    FROM password_reset_tokens t JOIN app_users u ON u.id=t.user_id
    WHERE t.token_hash=? AND t.expires_at>CURRENT_TIMESTAMP LIMIT 1`).bind(digest(input.token.trim())).first<Record<string, unknown>>();
  if (!row || row.status === "disabled") throw new Error("This reset link is invalid or has expired");

  const passwordHash = await hash(password, 12);
  const db = database();
  await db.prepare("UPDATE app_users SET password_hash=?,status='active',last_seen_at=CURRENT_TIMESTAMP WHERE id=?").bind(passwordHash, row.user_id).run();
  await db.prepare("DELETE FROM password_reset_tokens WHERE user_id=?").bind(row.user_id).run();
  await db.prepare("DELETE FROM app_sessions WHERE user_id=?").bind(row.user_id).run();
  await logAudit(Number(row.user_id), "password reset", "security", Number(row.user_id), `${String(row.display_name)} reset their password`, { email: String(row.email) });
}

export async function setUserPassword(userId: number, newPassword: string) {
  await ensureAuthSchema();
  if (newPassword.length < 10) throw new Error("Password must be at least 10 characters");
  const passwordHash = await hash(newPassword, 12);
  const db = database();
  await db.prepare("UPDATE app_users SET password_hash=?,status='active',last_seen_at=CURRENT_TIMESTAMP WHERE id=?").bind(passwordHash, userId).run();
  await db.prepare("DELETE FROM app_sessions WHERE user_id=?").bind(userId).run();
  await db.prepare("DELETE FROM password_reset_tokens WHERE user_id=?").bind(userId).run();
}

export async function clearUserPassword(userId: number) {
  await ensureAuthSchema();
  const db = database();
  await db.prepare("UPDATE app_users SET password_hash=NULL,status='invited',platform_user_id=NULL WHERE id=?").bind(userId).run();
  await db.prepare("DELETE FROM app_sessions WHERE user_id=?").bind(userId).run();
  await db.prepare("DELETE FROM password_reset_tokens WHERE user_id=?").bind(userId).run();
}

export async function changePassword(userId: number, currentPassword: string, newPassword: string) {
  await ensureAuthSchema();
  if (newPassword.length < 10) throw new Error("Password must be at least 10 characters");
  const db = database();
  const row = await db.prepare("SELECT password_hash FROM app_users WHERE id=?").bind(userId).first<{ password_hash: string | null }>();
  if (!row?.password_hash) throw new Error("Password sign-in is not configured for this account");
  if (!(await compare(currentPassword, row.password_hash))) throw new Error("Current password is incorrect");
  const passwordHash = await hash(newPassword, 12);
  await db.prepare("UPDATE app_users SET password_hash=? WHERE id=?").bind(passwordHash, userId).run();
}

