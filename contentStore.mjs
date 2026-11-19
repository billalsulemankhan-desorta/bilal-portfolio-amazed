import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { deleteRecord, isTokenRevoked, readRecord, revokeToken, writeRecord } from "./store.mjs";

const configuredHash =
  process.env.PORTFOLIO_DEV_PASSWORD_HASH ||
  "04ada28f86c9223249f47b9123335acea9ea6e7be856662125f9405b510ee616";
const SESSION_TTL = 12 * 60 * 60 * 1000;
const secret = process.env.SESSION_SECRET || configuredHash;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sign(value) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function verifyPassword(value) {
  if (typeof value !== "string" || !value) return false;
  const candidate = Buffer.from(sha256(value), "hex");
  const expected = Buffer.from(configuredHash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function createSession() {
  const expires = Date.now() + SESSION_TTL;
  const nonce = randomBytes(12).toString("hex");
  const payload = `${expires}.${nonce}`;
  return `${payload}.${sign(payload)}`;
}

export async function isValidSession(token) {
  if (typeof token !== "string" || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expiresText, nonce, signature] = parts;
  const expires = Number(expiresText);
  if (!Number.isFinite(expires) || !nonce || !signature) return false;
  if (expires < Date.now()) return false;
  const payload = `${expiresText}.${nonce}`;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    return !(await isTokenRevoked(token));
  } catch {
    return false;
  }
}

export async function revokeSession(token) {
  if (typeof token !== "string" || !token) return;
  const expires = Number(token.split(".")[0]);
  if (!Number.isFinite(expires) || expires < Date.now()) return;
  try {
    await revokeToken(token, expires);
  } catch {
    /* best effort */
  }
}

export async function readContent() {
  const record = await readRecord("content");
  const content = record.value;
  return {
    content: content && typeof content === "object" ? content : null,
    savedAt: record.savedAt,
  };
}

export async function writeContent(content) {
  return writeRecord("content", content);
}

export async function clearContent() {
  await deleteRecord("content");
}
