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
const http2 = require("node:http2");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");
const { URL } = require("node:url");
const { initDb } = require("./backend/db");
const {
  normalizeEmail,
  getUser,
  createUser,
  listTransactions,
  transferPoints,
  deleteExpiredSessions,
  deleteExpiredIdempotencyKeys,
  deleteExpiredRateLimits,
  deleteExpiredLoginFailures,
  consumeRateLimit,
  createSession,
  getSession,
  rotateSession,
  deleteSession,
  getIdempotencyResult,
  putIdempotencyResult,
  appendAuditEvent,
  listAuditEvents,
  getLoginLockout,
  recordLoginFailure,
  clearLoginFailures,
  listActiveLoginLockouts,
} = require("./backend/repo");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
const SESSION_ROTATE_AFTER_MS = Number(process.env.SESSION_ROTATE_AFTER_MS || 1000 * 60 * 60 * 6); // 6h
const ENABLE_GZIP = String(process.env.GZIP || "1") !== "0";
const GZIP_MIN_BYTES = Number(process.env.GZIP_MIN_BYTES || 1024);
const ENABLE_HTTP2 = String(process.env.HTTP2 || "0") === "1";
const HTTP2_KEY_FILE = process.env.HTTP2_KEY_FILE || path.join(__dirname, "certs", "localhost-key.pem");
const HTTP2_CERT_FILE = process.env.HTTP2_CERT_FILE || path.join(__dirname, "certs", "localhost-cert.pem");
// Basic abuse hardening
const MAX_JSON_BODY_BYTES = Number(process.env.MAX_JSON_BODY_BYTES || 64 * 1024); // 64KB
const HEADERS_TIMEOUT_MS = Number(process.env.HEADERS_TIMEOUT_MS || 10_000);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 15_000);
const KEEP_ALIVE_TIMEOUT_MS = Number(process.env.KEEP_ALIVE_TIMEOUT_MS || 5_000);
// Rate limiting (fixed window). Keep defaults conservative for local demos; tune via env.
const RL_LOGIN_IP_LIMIT = Number(process.env.RL_LOGIN_IP_LIMIT || 20);
const RL_LOGIN_IP_WINDOW_MS = Number(process.env.RL_LOGIN_IP_WINDOW_MS || 60_000);
const RL_LOGIN_ID_LIMIT = Number(process.env.RL_LOGIN_ID_LIMIT || 10);
const RL_LOGIN_ID_WINDOW_MS = Number(process.env.RL_LOGIN_ID_WINDOW_MS || 60_000);
const RL_SEND_LIMIT = Number(process.env.RL_SEND_LIMIT || 30);
const RL_SEND_WINDOW_MS = Number(process.env.RL_SEND_WINDOW_MS || 60_000);
const RL_REGISTER_IP_LIMIT = Number(process.env.RL_REGISTER_IP_LIMIT || 10);
const RL_REGISTER_IP_WINDOW_MS = Number(process.env.RL_REGISTER_IP_WINDOW_MS || 60_000);
// Account lockout
const LOCKOUT_SCOPE = String(process.env.LOCKOUT_SCOPE || "ip_email"); // ip_email | email
const LOCKOUT_THRESHOLD = Number(process.env.LOCKOUT_THRESHOLD || 5);
const LOCKOUT_WINDOW_MS = Number(process.env.LOCKOUT_WINDOW_MS || 15 * 60_000);
const LOCKOUT_DURATION_MS = Number(process.env.LOCKOUT_DURATION_MS || 15 * 60_000);
const LOCKOUT_MAX_MS = Number(process.env.LOCKOUT_MAX_MS || 24 * 60 * 60_000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
// Legacy signed-cookie support (we now use DB-backed opaque sessions).
// Keeping this allows seamless upgrade from older cookie format during local dev.
const SESSION_SECRET =
  process.env.SESSION_SECRET || "dev-only-change-me-please";

const STATIC_ROOT = __dirname;

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function requestIdFromReq(req) {
  return (
    req.headers["x-request-id"] ||
    req.headers["x-correlation-id"] ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"))
  );
}

function logEvent(obj) {
  try {
    console.log(JSON.stringify({ ts: new Date().toISOString(), ...obj }));
  } catch {
    console.log(String(obj));
  }
}

function parseNumberParam(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "");
  if (xf) return xf.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function rateLimitHeaders({ limit, remaining, resetAt }) {
  const resetSec = Math.max(0, Math.ceil((Number(resetAt) - Date.now()) / 1000));
  return {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Reset": String(Math.floor(Number(resetAt) / 1000)),
    "Retry-After": String(resetSec),
  };
}

function enforceRateLimit(req, res, { key, limit, windowMs }) {
  const r = consumeRateLimit({ key, limit, windowMs });
  if (!r.allowed) {
    return { ok: false, headers: rateLimitHeaders(r) };
  }
  return { ok: true, headers: rateLimitHeaders(r) };
}

function isAdmin(req) {
  if (!ADMIN_TOKEN) return false;
  const auth = String(req.headers.authorization || "");
  return auth === `Bearer ${ADMIN_TOKEN}`;
}

function send(res, statusCode, headers, body) {
  res.writeHead(statusCode, headers);
  res.end(body);
}

function ensureHttp2Certs() {
  try {
    fs.accessSync(HTTP2_KEY_FILE, fs.constants.R_OK);
    fs.accessSync(HTTP2_CERT_FILE, fs.constants.R_OK);
    return true;
  } catch {}

  // Best-effort: generate a local self-signed cert for localhost if openssl exists.
  try {
    fs.mkdirSync(path.dirname(HTTP2_KEY_FILE), { recursive: true });
    const r = spawnSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        HTTP2_KEY_FILE,
        "-out",
        HTTP2_CERT_FILE,
        "-days",
        "365",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
      ],
      { stdio: "ignore" }
    );
    if (r.status === 0) return true;
  } catch {}

  return false;
}

function acceptsGzip(req) {
  const ae = String(req.headers["accept-encoding"] || "");
  return /\bgzip\b/.test(ae);
}

function isCompressibleContentType(ct) {
  const t = String(ct || "").toLowerCase();
  return (
    t.startsWith("text/") ||
    t.includes("application/json") ||
    t.includes("application/javascript") ||
    t.includes("image/svg+xml")
  );
}

function sendMaybeGzip(req, res, statusCode, headers, body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8");
  const ct = headers["Content-Type"] || headers["content-type"] || "";
  if (
    ENABLE_GZIP &&
    acceptsGzip(req) &&
    isCompressibleContentType(ct) &&
    buf.length >= GZIP_MIN_BYTES
  ) {
    const gz = zlib.gzipSync(buf);
    send(res, statusCode, {
      ...headers,
      "Content-Encoding": "gzip",
      "Vary": "Accept-Encoding",
    }, gz);
    return;
  }
  send(res, statusCode, headers, buf);
}

function sendJson(req, res, statusCode, obj, extraHeaders = {}) {
  // Always set Vary so proxies/browsers don't mix compressed/uncompressed.
  sendMaybeGzip(
    req,
    res,
    statusCode,
    { ...JSON_HEADERS, "Vary": "Accept-Encoding", ...extraHeaders },
    JSON.stringify(obj)
  );
}

function sendText(req, res, statusCode, text, extraHeaders = {}) {
  sendMaybeGzip(
    req,
    res,
    statusCode,
    {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Vary": "Accept-Encoding",
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

function verifyLegacySignedSession(token) {
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

function isProbablyLegacySignedSession(token) {
  return typeof token === "string" && token.includes(".");
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

function cookieAttrs(req) {
  const isProd = process.env.NODE_ENV === "production";
  const secure = isProd ? "; Secure" : "";
  return `HttpOnly; SameSite=Lax; Path=/${secure}`;
}

function setSessionCookieHeader(sessionId, req) {
  return `session=${encodeURIComponent(sessionId)}; ${cookieAttrs(req)}`;
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > MAX_JSON_BODY_BYTES) {
      const err = new Error("Request entity too large");
      err.status = 413;
      throw err;
    }
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Note: users/transactions storage is now SQLite (via node:sqlite) in ./backend.

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
    return sendText(req, res, 400, "Bad path");
  }
  try {
    const stat = await fsp.stat(candidate);
    if (!stat.isFile()) return sendText(req, res, 404, "Not found");
    const stream = fs.createReadStream(candidate);
    const isProd = process.env.NODE_ENV === "production";
    const ct = contentTypeFor(candidate);
    const headers = {
      "Content-Type": ct,
      // In local dev we want fresh JS/CSS on refresh; in prod immutable is fine for dist assets.
      "Cache-Control": candidate.includes("/dist/") && isProd
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      "Vary": "Accept-Encoding",
    };
    if (ENABLE_GZIP && acceptsGzip(req) && isCompressibleContentType(ct) && stat.size >= GZIP_MIN_BYTES) {
      res.writeHead(200, { ...headers, "Content-Encoding": "gzip" });
      stream.pipe(zlib.createGzip()).pipe(res);
    } else {
      res.writeHead(200, headers);
      stream.pipe(res);
    }
    stream.on("error", () => {
      if (!res.headersSent) sendText(req, res, 500, "Read error");
      else res.destroy();
    });
  } catch {
    // SPA-like fallback for simple routes (e.g. "/transactions/") while staying static.
    // If the path has no extension, serve index.html so hash routing can take over.
    if (!path.extname(requested)) {
      try {
        const indexFile = path.join(STATIC_ROOT, "index.html");
        const stream = fs.createReadStream(indexFile);
        const ct = "text/html; charset=utf-8";
        const headers = { "Content-Type": ct, "Cache-Control": "no-cache", "Vary": "Accept-Encoding" };
        if (ENABLE_GZIP && acceptsGzip(req) && isCompressibleContentType(ct)) {
          res.writeHead(200, { ...headers, "Content-Encoding": "gzip" });
          stream.pipe(zlib.createGzip()).pipe(res);
        } else {
          res.writeHead(200, headers);
          stream.pipe(res);
        }
        stream.on("error", () => {
          if (!res.headersSent) sendText(req, res, 500, "Read error");
          else res.destroy();
        });
        return;
      } catch {
        // fallthrough
      }
    }
    return sendText(req, res, 404, "Not found");
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

  // Light cleanup to avoid unbounded growth.
  try { deleteExpiredSessions(); } catch {}
  try { deleteExpiredIdempotencyKeys(); } catch {}
  try { deleteExpiredRateLimits(); } catch {}
  try { deleteExpiredLoginFailures(); } catch {}

  const requestId = req._requestId || requestIdFromReq(req);

  const cookies = parseCookies(req);
  const rawSession = cookies.session;
  let session = null; // { sub, exp }
  let extraHeaders = {};

  if (rawSession) {
    if (isProbablyLegacySignedSession(rawSession)) {
      const legacy = verifyLegacySignedSession(rawSession);
      if (legacy?.sub) {
        const user = getUser(legacy.sub);
        if (user) {
          const s = createSession({
            userEmail: legacy.sub,
            ttlMs: 1000 * 60 * 60 * 24 * 7,
            userAgent: req.headers["user-agent"] || null,
            ip: req.socket?.remoteAddress || null,
          });
          session = { sub: s.userEmail, exp: s.expiresAt };
          extraHeaders = { ...extraHeaders, "Set-Cookie": setSessionCookieHeader(s.sessionId, req) };
        }
      }
    } else {
      const rot = rotateSession(rawSession, {
        rotateAfterMs: SESSION_ROTATE_AFTER_MS,
        userAgent: req.headers["user-agent"] || null,
        ip: req.socket?.remoteAddress || null,
      });
      if (rot?.sessionId) {
        const s = getSession(rot.sessionId);
        if (s) {
          session = { sub: s.sub, exp: s.exp };
          // Keep CSRF token available for enforcement / /api/me response
          session.csrfToken = s.csrfToken;
          if (rot.rotated) {
            extraHeaders = { ...extraHeaders, "Set-Cookie": setSessionCookieHeader(rot.sessionId, req) };
          }
        }
      }
    }
  }

  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /health") {
    return sendJson(req, res, 200, { ok: true, ts: new Date().toISOString() });
  }

  // Minimal admin endpoints (token-protected) to inspect/clear lockouts locally.
  if (route === "POST /api/admin/unlock") {
    if (!isAdmin(req)) return sendJson(req, res, 401, { error: "Unauthorized" });
    let b;
    try { b = await readJsonBody(req); } catch (e) {
      if (e?.status === 413) return sendJson(req, res, 413, { error: "Payload too large" });
      throw e;
    }
    if (!b) return sendJson(req, res, 400, { error: "Invalid JSON" });
    const key = String(b.key || "").trim() || (() => {
      const email = normalizeEmail(b.email);
      const ip = String(b.ip || "").trim() || clientIp(req);
      return LOCKOUT_SCOPE === "email" ? `lock:email:${email}` : `lock:ip_email:${ip}:${email}`;
    })();
    try { clearLoginFailures(key); } catch {}
    appendAuditEvent({
      actorEmail: null,
      action: "admin.unlock",
      requestId,
      ip: clientIp(req),
      userAgent: req.headers["user-agent"] || null,
      meta: { key },
    });
    return sendJson(req, res, 200, { ok: true });
  }

  if (route === "GET /api/admin/lockouts") {
    if (!isAdmin(req)) return sendJson(req, res, 401, { error: "Unauthorized" });
    const list = listActiveLoginLockouts({ limit: 200 });
    appendAuditEvent({
      actorEmail: null,
      action: "admin.lockouts.list",
      requestId,
      ip: clientIp(req),
      userAgent: req.headers["user-agent"] || null,
      meta: { count: list.length },
    });
    return sendJson(req, res, 200, { ok: true, lockouts: list });
  }

  if (route === "GET /api/admin/audit") {
    if (!isAdmin(req)) return sendJson(req, res, 401, { error: "Unauthorized" });
    const q = url.searchParams;
    const since = parseNumberParam(q.get("since"));
    const until = parseNumberParam(q.get("until"));
    const actorEmail = q.get("actor") ? normalizeEmail(q.get("actor")) : null;
    const action = q.get("action") ? String(q.get("action")) : null;
    const limit = parseNumberParam(q.get("limit")) || 200;
    const events = listAuditEvents({ sinceTs: since, untilTs: until, actorEmail, action, limit });
    appendAuditEvent({
      actorEmail: null,
      action: "admin.audit.list",
      requestId,
      ip: clientIp(req),
      userAgent: req.headers["user-agent"] || null,
      meta: { since, until, actorEmail, action, limit, returned: events.length },
    });
    return sendJson(req, res, 200, { ok: true, events });
  }

  // CSRF enforcement for state-changing API calls when authenticated (cookie-based).
  // Exempt login/register (no session yet).
  if (
    req.method === "POST" &&
    url.pathname.startsWith("/api/") &&
    route !== "POST /api/login" &&
    route !== "POST /api/register" &&
    route !== "POST /api/admin/unlock" &&
    session
  ) {
    const csrf = String(req.headers["x-csrf-token"] || "");
    if (!csrf || csrf !== String(session.csrfToken || "")) {
      appendAuditEvent({
        actorEmail: session.sub,
        action: "csrf.failed",
        requestId,
        ip: req.socket?.remoteAddress || null,
        userAgent: req.headers["user-agent"] || null,
        meta: { route },
      });
      return sendJson(req, res, 403, { error: "CSRF token missing or invalid" }, extraHeaders);
    }
  }

  if (route === "POST /api/register") {
    // Rate limit registrations per IP
    {
      const ip = clientIp(req);
      const rl = enforceRateLimit(req, res, { key: `register:ip:${ip}`, limit: RL_REGISTER_IP_LIMIT, windowMs: RL_REGISTER_IP_WINDOW_MS });
      if (!rl.ok) return sendJson(req, res, 429, { error: "Too many requests" }, rl.headers);
      // expose headers even when allowed
      Object.entries(rl.headers).forEach(([k, v]) => res.setHeader(k, v));
    }
    let body;
    try { body = await readJsonBody(req); } catch (e) {
      if (e?.status === 413) return sendJson(req, res, 413, { error: "Payload too large" });
      throw e;
    }
    if (!body) return sendJson(req, res, 400, { error: "Invalid JSON" });
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    if (!email || !email.includes("@")) {
      return sendJson(req, res, 400, { error: "Invalid email" });
    }
    if (password.length < 8) {
      return sendJson(req, res, 400, { error: "Password must be at least 8 chars" });
    }

    const existing = getUser(email);
    if (existing) {
      return sendJson(req, res, 409, { error: "User already exists" });
    }
    const { salt, hash } = hashPassword(password);
    createUser({
      email,
      salt,
      hash,
      points: 5000,
      createdAt: new Date().toISOString(),
    });
    appendAuditEvent({
      actorEmail: email,
      action: "register.success",
      requestId,
      ip: req.socket?.remoteAddress || null,
      userAgent: req.headers["user-agent"] || null,
    });
    return sendJson(req, res, 201, { ok: true });
  }

  if (route === "POST /api/login") {
    let body;
    try { body = await readJsonBody(req); } catch (e) {
      if (e?.status === 413) return sendJson(req, res, 413, { error: "Payload too large" });
      throw e;
    }
    if (!body) return sendJson(req, res, 400, { error: "Invalid JSON" });
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");

    // Account lockout check (before password verify)
    {
      const ip = clientIp(req);
      const key = LOCKOUT_SCOPE === "email" ? `lock:email:${email}` : `lock:ip_email:${ip}:${email}`;
      const lock = getLoginLockout(key);
      if (lock?.lockedUntil) {
        const retryAfter = Math.max(0, Math.ceil((lock.lockedUntil - Date.now()) / 1000));
        return sendJson(
          req,
          res,
          429,
          { error: "Too many failed attempts. Try again later." },
          {
            "Retry-After": String(retryAfter),
            "X-Account-Locked-Until": String(Math.floor(lock.lockedUntil / 1000)),
          }
        );
      }
    }

    // Rate limit login attempts:
    // - per IP
    // - per IP+email (to slow targeted brute-force)
    {
      const ip = clientIp(req);
      const ipRl = enforceRateLimit(req, res, { key: `login:ip:${ip}`, limit: RL_LOGIN_IP_LIMIT, windowMs: RL_LOGIN_IP_WINDOW_MS });
      if (!ipRl.ok) return sendJson(req, res, 429, { error: "Too many requests" }, ipRl.headers);
      Object.entries(ipRl.headers).forEach(([k, v]) => res.setHeader(k, v));

      const idKey = email ? `login:id:${ip}:${email}` : `login:id:${ip}:_`;
      const idRl = enforceRateLimit(req, res, { key: idKey, limit: RL_LOGIN_ID_LIMIT, windowMs: RL_LOGIN_ID_WINDOW_MS });
      if (!idRl.ok) return sendJson(req, res, 429, { error: "Too many requests" }, idRl.headers);
    }
    const user = getUser(email);
    if (!user || !verifyPassword(password, user.salt, user.hash)) {
      // Record a failed attempt (may trigger lockout)
      try {
        const ip = clientIp(req);
        const key = LOCKOUT_SCOPE === "email" ? `lock:email:${email}` : `lock:ip_email:${ip}:${email}`;
        const r = recordLoginFailure({
          key,
          threshold: LOCKOUT_THRESHOLD,
          windowMs: LOCKOUT_WINDOW_MS,
          lockMs: LOCKOUT_DURATION_MS,
          maxLockMs: LOCKOUT_MAX_MS,
        });
        if (r?.locked) {
          appendAuditEvent({
            actorEmail: null,
            action: "login.locked",
            requestId,
            ip,
            userAgent: req.headers["user-agent"] || null,
            meta: { email, lockedUntil: r.lockedUntil },
          });
        }
      } catch {}
      appendAuditEvent({
        actorEmail: null,
        action: "login.failed",
        requestId,
        ip: req.socket?.remoteAddress || null,
        userAgent: req.headers["user-agent"] || null,
        meta: { email },
      });
      return sendJson(req, res, 401, { error: "Invalid credentials" });
    }

    // Clear failures on successful login
    try {
      const ip = clientIp(req);
      const key = LOCKOUT_SCOPE === "email" ? `lock:email:${email}` : `lock:ip_email:${ip}:${email}`;
      clearLoginFailures(key);
    } catch {}
    const s = createSession({
      userEmail: email,
      ttlMs: 1000 * 60 * 60 * 24 * 7,
      userAgent: req.headers["user-agent"] || null,
      ip: req.socket?.remoteAddress || null,
    });
    appendAuditEvent({
      actorEmail: email,
      action: "login.success",
      requestId,
      ip: req.socket?.remoteAddress || null,
      userAgent: req.headers["user-agent"] || null,
    });
    return sendJson(
      req,
      res,
      200,
      { ok: true, email },
      {
        ...extraHeaders,
        "Set-Cookie": setSessionCookieHeader(s.sessionId, req),
      }
    );
  }

  if (route === "POST /api/logout") {
    if (rawSession && !isProbablyLegacySignedSession(rawSession)) {
      try { deleteSession(rawSession); } catch {}
    }
    if (session?.sub) {
      appendAuditEvent({
        actorEmail: session.sub,
        action: "logout",
        requestId,
        ip: req.socket?.remoteAddress || null,
        userAgent: req.headers["user-agent"] || null,
      });
    }
    return sendJson(
      req,
      res,
      200,
      { ok: true },
      { ...extraHeaders, "Set-Cookie": "session=; Max-Age=0; Path=/; SameSite=Lax" }
    );
  }

  if (route === "GET /api/me") {
    if (!session) return sendJson(req, res, 401, { error: "Unauthenticated" }, extraHeaders);
    const email = session.sub;
    const user = getUser(email);
    if (!user) return sendJson(req, res, 401, { error: "Unauthenticated" }, extraHeaders);
    return sendJson(req, res, 200, {
      ok: true,
      user: { email: user.email, points: user.points },
      csrfToken: session.csrfToken || "",
    }, extraHeaders);
  }

  if (route === "GET /api/transactions") {
    if (!session) return sendJson(req, res, 401, { error: "Unauthenticated" }, extraHeaders);
    const email = session.sub;
    const user = getUser(email);
    if (!user) return sendJson(req, res, 401, { error: "Unauthenticated" }, extraHeaders);
    const q = url.searchParams;
    const limit = Number(q.get("limit") || 50);
    const since = q.get("since") ? String(q.get("since")) : null;
    const until = q.get("until") ? String(q.get("until")) : null;
    const transactions = listTransactions(email, { limit, since, until });
    return sendJson(req, res, 200, { ok: true, transactions }, extraHeaders);
  }

  if ((req.method === "GET" || req.method === "HEAD") && url.pathname === "/api/statement.csv") {
    if (!session) return sendJson(req, res, 401, { error: "Unauthenticated" }, extraHeaders);
    const email = session.sub;
    const user = getUser(email);
    if (!user) return sendJson(req, res, 401, { error: "Unauthenticated" }, extraHeaders);

    const q = url.searchParams;
    const since = q.get("since") ? String(q.get("since")) : null;
    const until = q.get("until") ? String(q.get("until")) : null;

    const txs = listTransactions(email, { limit: 1000, since, until });
    const lines = ["date,type,points,counterparty"];
    for (const tx of txs || []) {
      const dir = tx.direction === "in" ? "in" : "out";
      const other = dir === "in" ? (tx.from || "") : (tx.to || "");
      const date = String(tx.ts || "");
      const points = String(tx.points ?? "");
      // Basic CSV escaping for values with quotes/commas/newlines
      const esc = (v) => {
        const s = String(v ?? "");
        return /[\",\n\r]/.test(s) ? `"${s.replaceAll("\"", "\"\"")}"` : s;
      };
      lines.push([esc(date), esc(dir), esc(points), esc(other)].join(","));
    }
    const body = req.method === "HEAD" ? "" : (lines.join("\n") + "\n");
    return sendMaybeGzip(req, res, 200, {
      ...extraHeaders,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="statement.csv"',
    }, body);
  }

  if (route === "POST /api/send-points") {
    // Rate limit transfers per authenticated user (and implicitly per session/IP).
    {
      const ip = clientIp(req);
      const key = session?.sub ? `send:usr:${session.sub}` : `send:ip:${ip}`;
      const rl = enforceRateLimit(req, res, { key, limit: RL_SEND_LIMIT, windowMs: RL_SEND_WINDOW_MS });
      if (!rl.ok) return sendJson(req, res, 429, { error: "Too many requests" }, { ...extraHeaders, ...rl.headers });
      Object.entries(rl.headers).forEach(([k, v]) => res.setHeader(k, v));
    }
    if (!session) return sendJson(req, res, 401, { error: "Unauthenticated" }, extraHeaders);
    let body;
    try { body = await readJsonBody(req); } catch (e) {
      if (e?.status === 413) return sendJson(req, res, 413, { error: "Payload too large" }, extraHeaders);
      throw e;
    }
    if (!body) return sendJson(req, res, 400, { error: "Invalid JSON" }, extraHeaders);
    const to = normalizeEmail(body.to);
    const points = Number(body.points);
    if (!to || !to.includes("@")) {
      return sendJson(req, res, 400, { error: "Invalid recipient" }, extraHeaders);
    }
    if (!Number.isFinite(points) || points <= 0 || !Number.isInteger(points)) {
      return sendJson(req, res, 400, { error: "Points must be a positive integer" }, extraHeaders);
    }

    const from = session.sub;
    const idemKey =
      String(req.headers["idempotency-key"] || req.headers["x-idempotency-key"] || "").trim() ||
      null;
    if (idemKey) {
      const cached = getIdempotencyResult({ userEmail: from, scope: "send-points", key: idemKey });
      if (cached) {
        return sendJson(req, res, cached.status, cached.body, extraHeaders);
      }
    }
    const ts = new Date().toISOString();
    const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
    let balance;
    try {
      balance = transferPoints({ id, ts, from, to, points }).balance;
    } catch (e) {
      const status = e?.status || 500;
      appendAuditEvent({
        actorEmail: from,
        action: "send_points.failed",
        requestId,
        ip: req.socket?.remoteAddress || null,
        userAgent: req.headers["user-agent"] || null,
        meta: { to, points, status, error: e?.message || "Transfer failed" },
      });
      return sendJson(req, res, status, { error: e?.message || "Transfer failed" }, extraHeaders);
    }
    const respBody = {
      ok: true,
      from,
      to,
      sent: points,
      balance,
    };
    if (idemKey) {
      putIdempotencyResult({ userEmail: from, scope: "send-points", key: idemKey, status: 200, body: respBody, ttlMs: 1000 * 60 * 10 });
    }
    appendAuditEvent({
      actorEmail: from,
      action: "send_points.success",
      requestId,
      ip: req.socket?.remoteAddress || null,
      userAgent: req.headers["user-agent"] || null,
      meta: { to, points, txId: id },
    });
    return sendJson(req, res, 200, respBody, extraHeaders);
  }

  return sendJson(req, res, 404, { error: "Not found" });
}

async function handler(req, res) {
  const start = process.hrtime.bigint();
  const method = req.method;
  const requestId = requestIdFromReq(req);
  req._requestId = requestId;
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  // Minimal security headers suitable for local dev.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Request-Id", requestId);
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data:; font-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'"
  );

  res.on("finish", () => {
    const end = process.hrtime.bigint();
    const durMs = Number(end - start) / 1e6;
    logEvent({
      type: "access",
      method,
      path: url.pathname,
      status: res.statusCode,
      durMs: Number(durMs.toFixed(1)),
      requestId: res.getHeader("X-Request-Id") || null,
      ip: clientIp(req),
    });
  });

  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
  return handleStatic(req, res, url);
}

function startServer() {
  const onReq = (req, res) => {
    handler(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) sendText(req, res, 500, "Internal error");
      else res.destroy();
    });
  };

  if (ENABLE_HTTP2) {
    try {
      if (!ensureHttp2Certs()) {
        throw new Error(`Missing HTTP/2 TLS cert/key. Generate via openssl into ${path.dirname(HTTP2_KEY_FILE)}`);
      }
      const key = fs.readFileSync(HTTP2_KEY_FILE);
      const cert = fs.readFileSync(HTTP2_CERT_FILE);
      const srv = http2.createSecureServer({ key, cert, allowHTTP1: true }, onReq);
      srv.headersTimeout = HEADERS_TIMEOUT_MS;
      srv.requestTimeout = REQUEST_TIMEOUT_MS;
      srv.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
      srv.listen(PORT, HOST, () => {
        console.log(`Local server running at https://${HOST}:${PORT} (HTTP/2 enabled, allowHTTP1=true)`);
      });
      return srv;
    } catch (e) {
      console.warn(
        `HTTP/2 requested but cert/key missing or unreadable. Falling back to HTTP/1.1. (${e?.message || e})`
      );
    }
  }

  const srv = http.createServer(onReq);
  srv.headersTimeout = HEADERS_TIMEOUT_MS;
  srv.requestTimeout = REQUEST_TIMEOUT_MS;
  srv.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  srv.listen(PORT, HOST, () => {
    console.log(`Local server running at http://${HOST}:${PORT}`);
  });
  return srv;
}

// Initialize DB on startup (imports users.json into data/account.db once, if DB is empty).
initDb()
  .then(() => {
    const srv = startServer();
    const shutdown = (signal) => {
      console.log(`Shutting down (${signal})...`);
      try {
        srv?.close?.(() => process.exit(0));
        // Force-exit if something is stuck (e.g., keep-alive) after a short grace period
        setTimeout(() => process.exit(0), 1500).unref?.();
      } catch {
        process.exit(0);
      }
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  })
  .catch((e) => {
    console.error("Failed to init DB:", e);
    process.exitCode = 1;
  });


