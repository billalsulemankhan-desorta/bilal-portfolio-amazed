import { randomUUID } from "node:crypto";
import { readRecord, writeRecord } from "./store.mjs";

const MAX_ITEMS = 300;
let queue = Promise.resolve();

function serialize(task) {
  const result = queue.then(task, task);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function readRaw() {
  const { value } = await readRecord("feedback");
  return Array.isArray(value) ? value : [];
}

async function writeRaw(items) {
  await writeRecord("feedback", items.slice(0, MAX_ITEMS));
}

export function sanitizeSubmission(body) {
  if (!body || typeof body !== "object") return null;
  const clean = (value, max) =>
    typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
  const name = clean(body.name, 48);
  const message = clean(body.message, 900);
  const rating = Number(body.rating);
  if (!name || !message || !Number.isInteger(rating) || rating < 1 || rating > 5) return null;
  return { name, message, rating };
}

export function publicExperiences(items) {
  return items.filter((item) => item && item.status === "approved");
}

export async function readExperiences() {
  return readRaw();
}

export async function addExperience(submission) {
  return serialize(async () => {
    const items = await readRaw();
    const item = {
      id: randomUUID().slice(0, 12),
      ...submission,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    await writeRaw([item, ...items]);
    return item;
  });
}

export async function updateExperience(id, status) {
  return serialize(async () => {
    const items = await readRaw();
    let updated = null;
    const next = items.map((item) => {
      if (!item || item.id !== id) return item;
      updated = { ...item, status };
      return updated;
    });
    if (!updated) return null;
    await writeRaw(next);
    return updated;
  });
}

export async function deleteExperience(id) {
  return serialize(async () => {
    const items = await readRaw();
    const next = items.filter((item) => item && item.id !== id);
    if (next.length === items.length) return false;
    await writeRaw(next);
    return true;
  });
}
