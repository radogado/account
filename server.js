/**
 * Minimal local backend for the static fintech dashboard.
 *
 * Goals:
 * - No external dependencies (native Node.js only)
 * - Serve existing static frontend assets
 * - Provide simple auth + points APIs for local/dev demos
 *
 * NOT production-ready. For production, use a real DB, hardened auth, CSP, etc.
 */
const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const SESSION_SECRET =
  process.env.SESSION_SECRET || "dev-only-change-me-please";

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");

const STATIC_ROOT = __dirname;

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function send(res, statusCode, headers, body) {
  res.writeHead(statusCode, headers);
  res.end(body);
}

function sendJson(res, statusCode, obj, extraHeaders = {}) {
  send(
    res,
    statusCode,
    { ...JSON_HEADERS, ...extraHeaders },
    JSON.stringify(obj)
  );
}

function sendText(res, statusCode, text, extraHeaders = {}) {
  send(
    res,
    statusCode,
    {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
    text
  );
}

function base64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64urlJson(obj) {
  return base64url(Buffer.from(JSON.stringify(obj)));
}

function signSession(payload) {
  const body = base64urlJson(payload);
  const sig = base64url(
    crypto.createHmac("sha256", SESSION_SECRET).update(body).digest()
  );
  return `${body}.${sig}`;
}

function verifySession(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = base64url(
    crypto.createHmac("sha256", SESSION_SECRET).update(body).digest()
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(
      Buffer.from(body.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString(
        "utf8"
      )
    );
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.sub !== "string") return null;
  if (typeof payload.exp !== "number") return null;
  if (Date.now() > payload.exp) return null;
  return payload;
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function ensureDataFiles() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    await fsp.access(USERS_FILE, fs.constants.F_OK);
  } catch {
    await fsp.writeFile(
      USERS_FILE,
      JSON.stringify({ users: {} }, null, 2),
      "utf8"
    );
  }
}

async function loadUsers() {
  await ensureDataFiles();
  const raw = await fsp.readFile(USERS_FILE, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || !parsed.users) {
    return { users: {} };
  }
  return parsed;
}

async function saveUsers(data) {
  await ensureDataFiles();
  await fsp.writeFile(USERS_FILE, JSON.stringify(data, null, 2), "utf8");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function hashPassword(password, saltBase64) {
  const salt = saltBase64
    ? Buffer.from(saltBase64, "base64")
    : crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, 64);
  return { salt: salt.toString("base64"), hash: key.toString("base64") };
}

function verifyPassword(password, saltBase64, hashBase64) {
  const salt = Buffer.from(String(saltBase64), "base64");
  const expected = Buffer.from(String(hashBase64), "base64");
  const actual = crypto.scryptSync(String(password), salt, expected.length);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".map":
      return "application/json; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function isSafePath(root, candidate) {
  const rel = path.relative(root, candidate);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

async function handleStatic(req, res, url) {
  // Serve "/" as index.html
  const pathname = decodeURIComponent(url.pathname);
  const requested = pathname === "/" ? "/index.html" : pathname;
  const candidate = path.join(STATIC_ROOT, requested);
  if (!isSafePath(STATIC_ROOT, candidate)) {
    return sendText(res, 400, "Bad path");
  }
  try {
    const stat = await fsp.stat(candidate);
    if (!stat.isFile()) return sendText(res, 404, "Not found");
    const stream = fs.createReadStream(candidate);
    const isProd = process.env.NODE_ENV === "production";
    res.writeHead(200, {
      "Content-Type": contentTypeFor(candidate),
      // In local dev we want fresh JS/CSS on refresh; in prod immutable is fine for dist assets.
      "Cache-Control": candidate.includes("/dist/") && isProd
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    });
    stream.pipe(res);
    stream.on("error", () => {
      if (!res.headersSent) sendText(res, 500, "Read error");
      else res.destroy();
    });
  } catch {
    // SPA-like fallback for simple routes (e.g. "/transactions/") while staying static.
    // If the path has no extension, serve index.html so hash routing can take over.
    if (!path.extname(requested)) {
      try {
        const indexFile = path.join(STATIC_ROOT, "index.html");
        const stream = fs.createReadStream(indexFile);
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        });
        stream.pipe(res);
        stream.on("error", () => {
          if (!res.headersSent) sendText(res, 500, "Read error");
          else res.destroy();
        });
        return;
      } catch {
        // fallthrough
      }
    }
    return sendText(res, 404, "Not found");
  }
}

async function handleApi(req, res, url) {
  // Basic CORS for local use if you serve frontend elsewhere.
  if (req.method === "OPTIONS") {
    return send(res, 204, {
      "Access-Control-Allow-Origin": req.headers.origin || "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Credentials": "true",
    });
  }

  const cookies = parseCookies(req);
  const session = verifySession(cookies.session);

  const route = `${req.method} ${url.pathname}`;

  if (route === "POST /api/register") {
    const body = await readJsonBody(req);
    if (!body) return sendJson(res, 400, { error: "Invalid JSON" });
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    if (!email || !email.includes("@")) {
      return sendJson(res, 400, { error: "Invalid email" });
    }
    if (password.length < 8) {
      return sendJson(res, 400, { error: "Password must be at least 8 chars" });
    }

    const db = await loadUsers();
    if (db.users[email]) {
      return sendJson(res, 409, { error: "User already exists" });
    }
    const { salt, hash } = hashPassword(password);
    db.users[email] = {
      email,
      salt,
      hash,
      points: 5000,
      createdAt: new Date().toISOString(),
    };
    await saveUsers(db);
    return sendJson(res, 201, { ok: true });
  }

  if (route === "POST /api/login") {
    const body = await readJsonBody(req);
    if (!body) return sendJson(res, 400, { error: "Invalid JSON" });
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    const db = await loadUsers();
    const user = db.users[email];
    if (!user) return sendJson(res, 401, { error: "Invalid credentials" });
    if (!verifyPassword(password, user.salt, user.hash)) {
      return sendJson(res, 401, { error: "Invalid credentials" });
    }
    const payload = {
      sub: email,
      iat: Date.now(),
      exp: Date.now() + 1000 * 60 * 60 * 24 * 7, // 7 days
    };
    const token = signSession(payload);
    return sendJson(
      res,
      200,
      { ok: true, email },
      {
        "Set-Cookie": `session=${encodeURIComponent(
          token
        )}; HttpOnly; SameSite=Lax; Path=/`,
      }
    );
  }

  if (route === "POST /api/logout") {
    return sendJson(
      res,
      200,
      { ok: true },
      { "Set-Cookie": "session=; Max-Age=0; Path=/; SameSite=Lax" }
    );
  }

  if (route === "GET /api/me") {
    if (!session) return sendJson(res, 401, { error: "Unauthenticated" });
    const email = session.sub;
    const db = await loadUsers();
    const user = db.users[email];
    if (!user) return sendJson(res, 401, { error: "Unauthenticated" });
    return sendJson(res, 200, {
      ok: true,
      user: { email: user.email, points: user.points },
    });
  }

  if (route === "GET /api/transactions") {
    if (!session) return sendJson(res, 401, { error: "Unauthenticated" });
    const email = session.sub;
    const db = await loadUsers();
    const user = db.users[email];
    if (!user) return sendJson(res, 401, { error: "Unauthenticated" });
    const tx = Array.isArray(user.transactions) ? user.transactions : [];
    // Return newest first, keep payload small
    const transactions = tx
      .slice()
      .sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")))
      .slice(0, 50);
    return sendJson(res, 200, { ok: true, transactions });
  }

  if (route === "POST /api/send-points") {
    if (!session) return sendJson(res, 401, { error: "Unauthenticated" });
    const body = await readJsonBody(req);
    if (!body) return sendJson(res, 400, { error: "Invalid JSON" });
    const to = normalizeEmail(body.to);
    const points = Number(body.points);
    if (!to || !to.includes("@")) {
      return sendJson(res, 400, { error: "Invalid recipient" });
    }
    if (!Number.isFinite(points) || points <= 0 || !Number.isInteger(points)) {
      return sendJson(res, 400, { error: "Points must be a positive integer" });
    }

    const from = session.sub;
    const db = await loadUsers();
    const sender = db.users[from];
    const recipient = db.users[to];
    if (!sender) return sendJson(res, 401, { error: "Unauthenticated" });
    if (!recipient) return sendJson(res, 404, { error: "Recipient not found" });
    if (to === from) return sendJson(res, 400, { error: "Cannot send to self" });
    if ((sender.points || 0) < points) {
      return sendJson(res, 400, { error: "Insufficient points" });
    }

    sender.points = (sender.points || 0) - points;
    recipient.points = (recipient.points || 0) + points;

    const ts = new Date().toISOString();
    const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
    const outTx = { id, ts, direction: "out", from, to, points };
    const inTx = { id, ts, direction: "in", from, to, points };
    if (!Array.isArray(sender.transactions)) sender.transactions = [];
    if (!Array.isArray(recipient.transactions)) recipient.transactions = [];
    sender.transactions.push(outTx);
    recipient.transactions.push(inTx);
    await saveUsers(db);
    return sendJson(res, 200, {
      ok: true,
      from,
      to,
      sent: points,
      balance: sender.points,
    });
  }

  return sendJson(res, 404, { error: "Not found" });
}

async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  // Minimal security headers suitable for local dev.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");

  if (url.pathname.startsWith("/api/")) {
    return handleApi(req, res, url);
  }
  return handleStatic(req, res, url);
}

http
  .createServer((req, res) => {
    handler(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) sendText(res, 500, "Internal error");
      else res.destroy();
    });
  })
  .listen(PORT, HOST, () => {
    console.log(`Local server running at http://${HOST}:${PORT}`);
  });


