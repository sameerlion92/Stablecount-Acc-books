import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { isSelfHosted } from "./self-host";

/** Persistent data root: database file and uploaded documents live here. */
export function getDataDir() {
  const configured = process.env.STABLECOUNT_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);
  if (process.env.NODE_ENV === "production") return path.join(process.cwd(), "data");
  return process.cwd();
}

export function getUploadsDir() {
  const configured = process.env.STABLECOUNT_DATA_DIR?.trim();
  if (configured || process.env.NODE_ENV === "production") {
    return path.join(getDataDir(), "uploads");
  }
  return path.join(process.cwd(), ".uploads");
}

export function getDatabaseFilePath() {
  return path.join(getDataDir(), "stablecount.db");
}

export function resolveDatabaseUrl() {
  if (isSelfHosted()) {
    return { url: `file:${getDatabaseFilePath()}`, token: undefined };
  }
  const hostedUrl =
    process.env.DATABASE_URL?.trim() ||
    process.env.TURSO_DATABASE_URL?.trim() ||
    process.env.Stable_TURSO_DATABASE_URL?.trim();
  if (hostedUrl) {
    return {
      url: hostedUrl,
      token:
        process.env.TURSO_AUTH_TOKEN?.trim() ||
        process.env.Stable_TURSO_AUTH_TOKEN?.trim() ||
        undefined,
    };
  }
  return { url: `file:${getDatabaseFilePath()}`, token: undefined };
}

export function sessionCookieSecure() {
  const override = process.env.COOKIE_SECURE?.trim().toLowerCase();
  if (override === "true") return true;
  if (override === "false") return false;
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) return appUrl.startsWith("https://");
  return false;
}

export function getPublicAppUrl(fallbackOrigin: string, request?: Request) {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (request) {
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
    const protocol = request.headers.get("x-forwarded-proto") || "http";
    if (host && !host.startsWith("0.0.0.0") && !host.startsWith("[::]")) {
      return `${protocol}://${host}`.replace(/\/$/, "");
    }
  }
  const fallback = new URL(fallbackOrigin);
  if (fallback.hostname !== "0.0.0.0" && fallback.hostname !== "::") {
    return fallbackOrigin.replace(/\/$/, "");
  }
  return fallbackOrigin.replace(/\/$/, "");
}

export function appRedirectPath(request: Request, pathname: string) {
  const origin = getPublicAppUrl(new URL(request.url).origin, request);
  return new URL(pathname.startsWith("/") ? pathname : `/${pathname}`, `${origin}/`);
}

export function storageMode() {
  if (isSelfHosted()) return "local" as const;
  if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) return "vercel-blob" as const;
  return "local" as const;
}

export async function ensureDataDirs() {
  const dataDir = getDataDir();
  const uploadsDir = getUploadsDir();
  await mkdir(dataDir, { recursive: true });
  await mkdir(uploadsDir, { recursive: true });
  await mkdir(path.join(dataDir, "backups"), { recursive: true });
  if (!existsSync(path.dirname(getDatabaseFilePath()))) {
    await mkdir(path.dirname(getDatabaseFilePath()), { recursive: true });
  }
}
