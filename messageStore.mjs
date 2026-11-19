import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { readRecord, writeRecord } from "./store.mjs";

const MAX_MESSAGES = 500;

const recipient = process.env.CONTACT_EMAIL || "billalsulemankhan@gmail.com";
const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpFrom = process.env.SMTP_FROM || smtpUser || `Portfolio Messenger <${recipient}>`;
const emailConfigured = Boolean(smtpHost && smtpUser && smtpPass && Number.isFinite(smtpPort));

let transporter = null;
let queue = Promise.resolve();

function serialize(task) {
  const result = queue.then(task, task);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function emailDeliveryConfigured() {
  return emailConfigured;
}

function getTransporter() {
  if (!emailConfigured) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: process.env.SMTP_SECURE === "true" || smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    });
  }
  return transporter;
}

export function sanitizeMessage(body) {
  if (!body || typeof body !== "object") return null;
  const clean = (value, max) =>
    typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
  const name = clean(body.name, 60);
  const email = clean(body.email, 120);
  const subject = clean(body.subject, 120) || "Portfolio message";
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 3000) : "";
  if (!name || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return { name, email, subject, message };
}

export async function deliverMessage(payload) {
  const mailer = getTransporter();
  if (!mailer) {
    return { delivered: false, reason: "Email delivery is not configured on the server." };
  }
  try {
    await mailer.sendMail({
      from: smtpFrom,
      to: recipient,
      replyTo: payload.email,
      subject: `Portfolio appointment — ${payload.subject} from ${payload.name}`,
      text: [
        `Name: ${payload.name}`,
        `Email: ${payload.email}`,
        `Subject: ${payload.subject}`,
        "",
        payload.message,
      ].join("\n"),
    });
    return { delivered: true };
  } catch (error) {
    return {
      delivered: false,
      reason: error instanceof Error ? error.message.slice(0, 200) : "Email delivery failed.",
    };
  }
}

async function readRaw() {
  const { value } = await readRecord("messages");
  return Array.isArray(value) ? value : [];
}

async function writeRaw(items) {
  await writeRecord("messages", items.slice(0, MAX_MESSAGES));
}

export async function saveMessage(payload, delivery) {
  return serialize(async () => {
    const items = await readRaw();
    const record = {
      id: randomUUID().slice(0, 12),
      ...payload,
      to: recipient,
      status: delivery.delivered ? "sent" : "stored",
      deliveryNote: delivery.reason || null,
      createdAt: new Date().toISOString(),
    };
    await writeRaw([record, ...items]);
    return record;
  });
}

export async function readMessages() {
  return readRaw();
}

export async function removeMessage(id) {
  return serialize(async () => {
    const items = await readRaw();
    const next = items.filter((item) => item && item.id !== id);
    if (next.length === items.length) return false;
    await writeRaw(next);
    return true;
  });
}
