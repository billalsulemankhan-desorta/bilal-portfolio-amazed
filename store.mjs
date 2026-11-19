import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const redisUrl = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, "");
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || "";

export const sharedStoreConfigured = Boolean(redisUrl && redisToken);
export const onVercel = Boolean(process.env.VERCEL);

const dataDir = path.resolve(process.cwd(), "data");
const memory = new Map();

/** Upstash REST command. Works from serverless functions with plain fetch. */
export async function sharedRedis(command, ...args) {
  if (!sharedStoreConfigured) throw new Error("Shared storage is not configured");
  const pathname = [command, ...args]
    .map((part) => encodeURIComponent(String(part)))
    .join("/");
  const response = await fetch(`${redisUrl}/${pathname}`, {
    headers: { Authorization: `Bearer ${redisToken}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Shared storage error (${response.status})`);
  const payload = await response.json();
  if (payload.error) throw new Error(String(payload.error));
  return payload.result;
}

function requireSharedStore(action) {
  if (onVercel && !sharedStoreConfigured) {
    throw new Error(
      `Shared storage is not configured. Add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to ${action}.`,
    );
  }
}

export async function readRecord(name) {
  if (sharedStoreConfigured) {
    const raw = await sharedRedis("get", `portfolio:${name}`);
    if (!raw) return { value: null, savedAt: null };
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && "value" in parsed) {
        return { value: parsed.value, savedAt: parsed.savedAt || null };
      }
      return { value: parsed, savedAt: null };
    } catch {
      return { value: null, savedAt: null };
    }
  }

  if (onVercel) {
    const entry = memory.get(name);
    return entry ? { value: entry.value, savedAt: entry.savedAt } : { value: null, savedAt: null };
  }

  const file = path.join(dataDir, `${name}.json`);
  try {
    const value = JSON.parse(await readFile(file, "utf8"));
    const info = await stat(file);
    return { value, savedAt: info.mtime.toISOString() };
  } catch {
    return { value: null, savedAt: null };
  }
}

export async function writeRecord(name, value) {
  requireSharedStore("enable publishing");
  const savedAt = new Date().toISOString();

  if (sharedStoreConfigured) {
    await sharedRedis("set", `portfolio:${name}`, JSON.stringify({ value, savedAt }));
    return savedAt;
  }

  if (onVercel) {
    memory.set(name, { value, savedAt });
    return savedAt;
  }

  await mkdir(dataDir, { recursive: true });
  const file = path.join(dataDir, `${name}.json`);
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), "utf8");
  await rename(temp, file);
  return savedAt;
}

export async function deleteRecord(name) {
  requireSharedStore("enable publishing");

  if (sharedStoreConfigured) {
    await sharedRedis("del", `portfolio:${name}`);
    return;
  }

  if (onVercel) {
    memory.delete(name);
    return;
  }

  try {
    await unlink(path.join(dataDir, `${name}.json`));
  } catch {
    /* nothing stored yet */
  }
}

function revokeKey(token) {
  return `portfolio:revoked:${createHash("sha256").update(token).digest("hex")}`;
}

export async function isTokenRevoked(token) {
  const key = revokeKey(token);
  if (sharedStoreConfigured) return Boolean(await sharedRedis("get", key));
  const expiry = memory.get(key);
  return typeof expiry === "number" && expiry > Date.now();
}

export async function revokeToken(token, expiresAt) {
  const key = revokeKey(token);
  const ttl = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
  if (sharedStoreConfigured) {
    await sharedRedis("set", key, "1", "EX", String(ttl));
    return;
  }
  memory.set(key, expiresAt);
}
