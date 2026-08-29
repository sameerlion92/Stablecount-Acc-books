import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { del as blobDel, get as blobGet, put as blobPut } from "@vercel/blob";

const LOCAL_PREFIX = "local:";

export type StoredObject = {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
};

function blobToken() {
  return process.env.BLOB_READ_WRITE_TOKEN?.trim() ?? "";
}

export function usesBlobStorage() {
  return blobToken().length > 0;
}

function uploadsRoot() {
  return path.join(process.cwd(), ".uploads");
}

function localKeyFromRef(ref: string) {
  return ref.startsWith(LOCAL_PREFIX) ? ref.slice(LOCAL_PREFIX.length) : ref;
}

function localFilePath(key: string) {
  return path.join(uploadsRoot(), key);
}

function localMetaPath(key: string) {
  return `${localFilePath(key)}.meta.json`;
}

function toWebStream(data: Buffer) {
  return Readable.toWeb(Readable.from(data)) as ReadableStream<Uint8Array>;
}

async function putLocal(key: string, file: File, contentType: string) {
  const filePath = localFilePath(key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, Buffer.from(await file.arrayBuffer()));
  await writeFile(localMetaPath(key), JSON.stringify({ contentType }));
  return { url: `${LOCAL_PREFIX}${key}` };
}

async function getLocal(ref: string): Promise<StoredObject | null> {
  const key = localKeyFromRef(ref);
  const filePath = localFilePath(key);
  if (!existsSync(filePath)) return null;
  let contentType = "application/octet-stream";
  try {
    const meta = JSON.parse(await readFile(localMetaPath(key), "utf8")) as { contentType?: string };
    if (meta.contentType) contentType = meta.contentType;
  } catch {
    /* metadata optional */
  }
  return { stream: toWebStream(await readFile(filePath)), contentType };
}

async function deleteLocal(ref: string) {
  const key = localKeyFromRef(ref);
  const filePath = localFilePath(key);
  await rm(filePath, { force: true });
  await rm(localMetaPath(key), { force: true });
}

export async function putObject(key: string, file: File, contentType: string) {
  if (usesBlobStorage()) {
    return blobPut(key, file, { access: "private", addRandomSuffix: false, contentType, token: blobToken() });
  }
  return putLocal(key, file, contentType);
}

export async function getObject(ref: string): Promise<StoredObject | null> {
  if (ref.startsWith(LOCAL_PREFIX)) {
    return getLocal(ref);
  }
  if (!usesBlobStorage()) return null;
  const object = await blobGet(ref, { access: "private", token: blobToken() });
  if (!object) return null;
  return {
    stream: object.stream,
    contentType: object.blob.contentType || "application/octet-stream",
  };
}

export async function deleteObject(ref: string) {
  if (ref.startsWith(LOCAL_PREFIX)) {
    await deleteLocal(ref);
    return;
  }
  if (!usesBlobStorage()) return;
  await blobDel(ref, { token: blobToken() });
}
