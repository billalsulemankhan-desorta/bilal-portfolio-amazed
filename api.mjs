import {
  clearContent,
  createSession,
  isValidSession,
  readContent,
  revokeSession,
  verifyPassword,
  writeContent,
} from "./contentStore.mjs";
import {
  addExperience,
  deleteExperience,
  publicExperiences,
  readExperiences,
  sanitizeSubmission,
  updateExperience,
} from "./feedbackStore.mjs";
import {
  deliverMessage,
  emailDeliveryConfigured,
  readMessages,
  removeMessage,
  sanitizeMessage,
  saveMessage,
} from "./messageStore.mjs";

const BODY_LIMIT = 24 * 1024 * 1024;
const messageAttempts = new Map();
const MESSAGE_WINDOW = 10 * 60 * 1000;
const MESSAGE_LIMIT = 5;

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  if (req.body !== undefined && req.body !== null && req.body !== "") {
    const body = req.body;
    if (Buffer.isBuffer(body)) {
      if (body.length === 0) return null;
      if (body.length > BODY_LIMIT) throw new Error("Content payload too large");
      return JSON.parse(body.toString("utf8"));
    }
    if (typeof body === "string") {
      if (!body) return null;
      if (Buffer.byteLength(body, "utf8") > BODY_LIMIT) throw new Error("Content payload too large");
      return JSON.parse(body);
    }
    if (typeof body === "object") {
      const size = Buffer.byteLength(JSON.stringify(body), "utf8");
      if (size > BODY_LIMIT) throw new Error("Content payload too large");
      return body;
    }
  }

  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new Error("Content payload too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function bearerToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

function rateLimitMessage(req) {
  const key = req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  for (const [ip, data] of messageAttempts) {
    if (data.expires < now) messageAttempts.delete(ip);
  }
  const entry = messageAttempts.get(key) || { count: 0, expires: now + MESSAGE_WINDOW };
  entry.count += 1;
  messageAttempts.set(key, entry);
  return entry.count > MESSAGE_LIMIT;
}

export async function handleApi(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  if (!url.pathname.startsWith("/api/")) return false;

  res.setHeader("Cache-Control", "no-store");

  try {
    if (url.pathname === "/api/content" && req.method === "GET") {
      return sendJson(res, 200, await readContent()), true;
    }

    if (url.pathname === "/api/content/auth" && req.method === "POST") {
      const body = await readJson(req);
      if (!body || typeof body.password !== "string") {
        sendJson(res, 400, { error: "Password required" });
        return true;
      }
      if (!verifyPassword(body.password)) {
        sendJson(res, 401, { error: "Incorrect password" });
        return true;
      }
      sendJson(res, 200, { token: createSession() });
      return true;
    }

    if (url.pathname === "/api/content" && req.method === "PUT") {
      const token = bearerToken(req);
      if (!(await isValidSession(token))) {
        sendJson(res, 401, { error: "Not authorised" });
        return true;
      }
      const content = await readJson(req);
      if (!content || typeof content !== "object" || !content.site) {
        sendJson(res, 400, { error: "Invalid content payload" });
        return true;
      }
      const savedAt = await writeContent(content);
      sendJson(res, 200, { ok: true, savedAt });
      return true;
    }

    if (url.pathname === "/api/content/logout" && req.method === "POST") {
      await revokeSession(bearerToken(req));
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (url.pathname === "/api/content" && req.method === "DELETE") {
      const token = bearerToken(req);
      if (!(await isValidSession(token))) {
        sendJson(res, 401, { error: "Not authorised" });
        return true;
      }
      await clearContent();
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (url.pathname === "/api/feedback" && req.method === "GET") {
      const admin = url.searchParams.get("all") === "1";
      if (admin && !(await isValidSession(bearerToken(req)))) {
        sendJson(res, 401, { error: "Not authorised" });
        return true;
      }
      const items = await readExperiences();
      sendJson(res, 200, { items: admin ? items : publicExperiences(items) });
      return true;
    }

    if (url.pathname === "/api/feedback" && req.method === "POST") {
      const submission = sanitizeSubmission(await readJson(req));
      if (!submission) {
        sendJson(res, 400, { error: "Add a name, a rating and a short message." });
        return true;
      }
      const item = await addExperience(submission);
      sendJson(res, 201, { ok: true, id: item.id, status: item.status });
      return true;
    }

    if (url.pathname === "/api/feedback" && req.method === "PATCH") {
      if (!(await isValidSession(bearerToken(req)))) {
        sendJson(res, 401, { error: "Not authorised" });
        return true;
      }
      const id = url.searchParams.get("id");
      const body = await readJson(req);
      const status = body && typeof body === "object" ? body.status : null;
      if (!id || (status !== "approved" && status !== "pending")) {
        sendJson(res, 400, { error: "Invalid update" });
        return true;
      }
      const updated = await updateExperience(id, status);
      if (!updated) {
        sendJson(res, 404, { error: "Reaction not found" });
        return true;
      }
      sendJson(res, 200, { ok: true, item: updated });
      return true;
    }

    if (url.pathname === "/api/feedback" && req.method === "DELETE") {
      if (!(await isValidSession(bearerToken(req)))) {
        sendJson(res, 401, { error: "Not authorised" });
        return true;
      }
      const id = url.searchParams.get("id");
      if (!id || !(await deleteExperience(id))) {
        sendJson(res, 404, { error: "Reaction not found" });
        return true;
      }
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (url.pathname === "/api/messages" && req.method === "GET") {
      if (!(await isValidSession(bearerToken(req)))) {
        sendJson(res, 401, { error: "Not authorised" });
        return true;
      }
      sendJson(res, 200, { items: await readMessages() });
      return true;
    }

    if (url.pathname === "/api/message" && req.method === "POST") {
      if (rateLimitMessage(req)) {
        sendJson(res, 429, { error: "Too many messages. Please try again later." });
        return true;
      }
      const payload = sanitizeMessage(await readJson(req));
      if (!payload) {
        sendJson(res, 400, { error: "Add your name, a valid email and a message." });
        return true;
      }
      const delivery = await deliverMessage(payload);
      const record = await saveMessage(payload, delivery);
      sendJson(res, 202, {
        ok: true,
        id: record.id,
        delivered: delivery.delivered,
        emailConfigured: emailDeliveryConfigured(),
      });
      return true;
    }

    if (url.pathname === "/api/messages" && req.method === "DELETE") {
      if (!(await isValidSession(bearerToken(req)))) {
        sendJson(res, 401, { error: "Not authorised" });
        return true;
      }
      const id = url.searchParams.get("id");
      if (!id || !(await removeMessage(id))) {
        sendJson(res, 404, { error: "Message not found" });
        return true;
      }
      sendJson(res, 200, { ok: true });
      return true;
    }

    sendJson(res, 404, { error: "Not found" });
    return true;
  } catch (error) {
    const text = error instanceof Error ? error.message : "Content server error";
    const tooLarge = text.toLowerCase().includes("too large");
    const configError = text.includes("Shared storage is not configured");
    sendJson(res, tooLarge ? 413 : configError ? 503 : 500, {
      error: tooLarge || configError ? text : "Content server error",
    });
    return true;
  }
}
