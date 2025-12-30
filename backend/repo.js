const { getDb } = require("./db");
const crypto = require("node:crypto");

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function deleteExpiredSessions(now = Date.now()) {
  const db = getDb();
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
}

function deleteExpiredIdempotencyKeys(now = Date.now()) {
  const db = getDb();
  db.prepare("DELETE FROM idempotency_keys WHERE expires_at <= ?").run(now);
}

function deleteExpiredRateLimits(now = Date.now()) {
  const db = getDb();
  db.prepare("DELETE FROM rate_limits WHERE expires_at <= ?").run(now);
}

function deleteExpiredLoginFailures(now = Date.now()) {
  const db = getDb();
  // Remove old rows that are not locked and haven't been touched in 24h
  const cutoff = now - 1000 * 60 * 60 * 24;
  db.prepare("DELETE FROM login_failures WHERE locked_until <= ? AND last_ts <= ?").run(now, cutoff);
}

function getLoginLockout(key, now = Date.now()) {
  const db = getDb();
  if (!key) return null;
  const row = db.prepare("SELECT locked_until, count, last_ts, lock_level FROM login_failures WHERE key = ?").get(String(key));
  if (!row) return null;
  const lockedUntil = Number(row.locked_until) || 0;
  if (lockedUntil > now) {
    return { lockedUntil, count: Number(row.count) || 0, lockLevel: Number(row.lock_level) || 0 };
  }
  return null;
}

function recordLoginFailure({ key, now = Date.now(), windowMs, threshold, lockMs, maxLockMs = 1000 * 60 * 60 * 24 }) {
  const db = getDb();
  if (!key) return { locked: false };
  if (!Number.isFinite(windowMs) || windowMs <= 0) windowMs = 15 * 60_000;
  if (!Number.isFinite(threshold) || threshold <= 0) threshold = 5;
  if (!Number.isFinite(lockMs) || lockMs <= 0) lockMs = 15 * 60_000;
  if (!Number.isFinite(maxLockMs) || maxLockMs <= 0) maxLockMs = 1000 * 60 * 60 * 24;

  const row = db.prepare("SELECT first_ts, last_ts, count, locked_until, lock_level FROM login_failures WHERE key = ?").get(String(key));
  const lastTs = Number(row?.last_ts) || 0;
  const lockedUntil = Number(row?.locked_until) || 0;
  if (lockedUntil > now) return { locked: true, lockedUntil };

  const inWindow = lastTs && now - lastTs <= windowMs;
  const nextCount = inWindow ? (Number(row?.count) || 0) + 1 : 1;
  const firstTs = inWindow ? (Number(row?.first_ts) || now) : now;
  const prevLockLevel = Number(row?.lock_level) || 0;
  const nextLockLevel = nextCount >= threshold ? prevLockLevel + 1 : prevLockLevel;
  const progressiveLockMs = Math.min(lockMs * Math.pow(2, Math.max(0, nextLockLevel - 1)), maxLockMs);
  const nextLockedUntil = nextCount >= threshold ? now + progressiveLockMs : 0;

  db.prepare(
    "INSERT INTO login_failures (key, first_ts, last_ts, count, locked_until, lock_level) VALUES (?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET first_ts = excluded.first_ts, last_ts = excluded.last_ts, count = excluded.count, locked_until = excluded.locked_until, lock_level = excluded.lock_level"
  ).run(String(key), firstTs, now, nextCount, nextLockedUntil, nextLockLevel);

  return { locked: nextLockedUntil > now, lockedUntil: nextLockedUntil || 0, count: nextCount, lockLevel: nextLockLevel };
}

function clearLoginFailures(key) {
  const db = getDb();
  if (!key) return;
  db.prepare("DELETE FROM login_failures WHERE key = ?").run(String(key));
}

function listActiveLoginLockouts({ now = Date.now(), limit = 200 } = {}) {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT key, first_ts, last_ts, count, locked_until, lock_level FROM login_failures WHERE locked_until > ? ORDER BY locked_until DESC LIMIT ?"
    )
    .all(now, limit);
  return (rows || []).map((r) => ({
    key: String(r.key),
    firstTs: Number(r.first_ts) || 0,
    lastTs: Number(r.last_ts) || 0,
    count: Number(r.count) || 0,
    lockedUntil: Number(r.locked_until) || 0,
    lockLevel: Number(r.lock_level) || 0,
  }));
}

function consumeRateLimit({ key, limit, windowMs, now = Date.now() }) {
  const db = getDb();
  if (!key || !Number.isFinite(limit) || !Number.isFinite(windowMs) || windowMs <= 0) {
    return { allowed: true, limit: limit || 0, remaining: 0, resetAt: now };
  }
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const expiresAt = windowStart + windowMs;

  db.prepare(
    `
    INSERT INTO rate_limits (key, window_start, expires_at, count)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE
        WHEN rate_limits.window_start < excluded.window_start THEN 1
        ELSE rate_limits.count + 1
      END,
      window_start = CASE
        WHEN rate_limits.window_start < excluded.window_start THEN excluded.window_start
        ELSE rate_limits.window_start
      END,
      expires_at = CASE
        WHEN rate_limits.window_start < excluded.window_start THEN excluded.expires_at
        ELSE rate_limits.expires_at
      END
    `
  ).run(String(key), windowStart, expiresAt);

  const row = db.prepare("SELECT count, expires_at FROM rate_limits WHERE key = ?").get(String(key));
  const count = Number(row?.count) || 0;
  const resetAt = Number(row?.expires_at) || expiresAt;
  const remaining = Math.max(0, limit - count);
  const allowed = count <= limit;
  return { allowed, limit, remaining, resetAt };
}

function createSession({ userEmail, ttlMs = 1000 * 60 * 60 * 24 * 7, userAgent = null, ip = null }) {
  const db = getDb();
  const now = Date.now();
  const sessionId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
  const csrfToken = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
  const createdAt = new Date(now).toISOString();
  const expiresAt = now + ttlMs;
  db.prepare(
    "INSERT INTO sessions (session_id, user_email, created_at, expires_at, last_seen_at, user_agent, ip, csrf_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(sessionId, userEmail, createdAt, expiresAt, now, userAgent, ip, csrfToken);
  return { sessionId, userEmail, createdAt, expiresAt, csrfToken };
}

function getSession(sessionId) {
  const db = getDb();
  if (!sessionId) return null;
  const now = Date.now();
  const s = db
    .prepare(
      "SELECT session_id, user_email, created_at, expires_at, last_seen_at, user_agent, ip, csrf_token FROM sessions WHERE session_id = ?"
    )
    .get(sessionId);
  if (!s) return null;
  if (Number(s.expires_at) <= now) {
    db.prepare("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
    return null;
  }
  // Ensure csrf token exists for older migrated rows.
  let csrfToken = s.csrf_token ? String(s.csrf_token) : "";
  if (!csrfToken) {
    csrfToken = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
    db.prepare("UPDATE sessions SET csrf_token = ? WHERE session_id = ?").run(csrfToken, sessionId);
  }
  // Touch last_seen (lightweight)
  db.prepare("UPDATE sessions SET last_seen_at = ? WHERE session_id = ?").run(now, sessionId);
  return {
    id: String(s.session_id),
    sub: String(s.user_email),
    exp: Number(s.expires_at),
    lastSeenAt: Number(s.last_seen_at) || 0,
    csrfToken,
  };
}

function rotateSession(sessionId, { rotateAfterMs = 1000 * 60 * 60 * 6, userAgent = null, ip = null } = {}) {
  const db = getDb();
  if (!sessionId) return null;
  const now = Date.now();

  db.exec("BEGIN IMMEDIATE");
  try {
    const s = db
      .prepare(
        "SELECT session_id, user_email, expires_at, last_seen_at, csrf_token FROM sessions WHERE session_id = ?"
      )
      .get(sessionId);
    if (!s) {
      db.exec("COMMIT");
      return null;
    }
    if (Number(s.expires_at) <= now) {
      db.prepare("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
      db.exec("COMMIT");
      return null;
    }

    const lastSeenAt = Number(s.last_seen_at) || 0;
    const shouldRotate = rotateAfterMs > 0 && now - lastSeenAt >= rotateAfterMs;
    if (!shouldRotate) {
      // Still update last_seen to reflect activity.
      db.prepare("UPDATE sessions SET last_seen_at = ? WHERE session_id = ?").run(now, sessionId);
      db.exec("COMMIT");
      return { rotated: false, sessionId };
    }

    const newId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
    const createdAt = new Date(now).toISOString();
    const csrfToken = s.csrf_token ? String(s.csrf_token) : (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"));
    db.prepare(
      "INSERT INTO sessions (session_id, user_email, created_at, expires_at, last_seen_at, user_agent, ip, csrf_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(newId, String(s.user_email), createdAt, Number(s.expires_at), now, userAgent, ip, csrfToken);

    db.prepare("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
    db.exec("COMMIT");
    return { rotated: true, sessionId: newId };
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    throw e;
  }
}

function deleteSession(sessionId) {
  const db = getDb();
  if (!sessionId) return;
  db.prepare("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
}

function getUser(email) {
  const db = getDb();
  return db.prepare("SELECT email, salt, hash, points, created_at FROM users WHERE email = ?").get(email) || null;
}

function createUser({ email, salt, hash, points, createdAt }) {
  const db = getDb();
  db.prepare(
    "INSERT INTO users (email, salt, hash, points, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(email, salt, hash, points, createdAt);
}

function listTransactions(email, limit = 50) {
  const db = getDb();
  return db.prepare(
    "SELECT id, ts, direction, from_email AS 'from', to_email AS 'to', points FROM transactions WHERE user_email = ? ORDER BY ts DESC LIMIT ?"
  ).all(email, limit);
}

function transferPoints({ id, ts, from, to, points }) {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const sender = db.prepare("SELECT email, points FROM users WHERE email = ?").get(from);
    if (!sender) {
      const err = new Error("Unauthenticated");
      err.status = 401;
      throw err;
    }
    const recipient = db.prepare("SELECT email, points FROM users WHERE email = ?").get(to);
    if (!recipient) {
      const err = new Error("Recipient not found");
      err.status = 404;
      throw err;
    }
    if (to === from) {
      const err = new Error("Cannot send to self");
      err.status = 400;
      throw err;
    }
    if ((sender.points || 0) < points) {
      const err = new Error("Insufficient points");
      err.status = 400;
      throw err;
    }

    db.prepare("UPDATE users SET points = points - ? WHERE email = ?").run(points, from);
    db.prepare("UPDATE users SET points = points + ? WHERE email = ?").run(points, to);

    const insTx = db.prepare(
      "INSERT INTO transactions (id, ts, direction, from_email, to_email, points, user_email) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    insTx.run(id, ts, "out", from, to, points, from);
    insTx.run(id, ts, "in", from, to, points, to);

    const balanceRow = db.prepare("SELECT points FROM users WHERE email = ?").get(from);
    db.exec("COMMIT");
    return { balance: balanceRow?.points ?? 0 };
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    throw e;
  }
}

function getIdempotencyResult({ userEmail, scope, key, now = Date.now() }) {
  const db = getDb();
  if (!userEmail || !scope || !key) return null;
  const row = db
    .prepare(
      "SELECT status, response_json, expires_at FROM idempotency_keys WHERE user_email = ? AND scope = ? AND idem_key = ?"
    )
    .get(userEmail, scope, key);
  if (!row) return null;
  if (Number(row.expires_at) <= now) {
    db.prepare(
      "DELETE FROM idempotency_keys WHERE user_email = ? AND scope = ? AND idem_key = ?"
    ).run(userEmail, scope, key);
    return null;
  }
  try {
    return { status: Number(row.status) || 200, body: JSON.parse(String(row.response_json || "{}")) };
  } catch {
    return { status: Number(row.status) || 200, body: {} };
  }
}

function putIdempotencyResult({ userEmail, scope, key, status, body, ttlMs = 1000 * 60 * 10 }) {
  const db = getDb();
  const now = Date.now();
  const expiresAt = now + ttlMs;
  db.prepare(
    "INSERT OR REPLACE INTO idempotency_keys (user_email, scope, idem_key, created_at, expires_at, status, response_json) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(userEmail, scope, key, now, expiresAt, status, JSON.stringify(body ?? {}));
}

function appendAuditEvent({ actorEmail = null, action, requestId = null, ip = null, userAgent = null, meta = null }) {
  const db = getDb();
  const ts = Date.now();
  const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
  db.prepare(
    "INSERT INTO audit_events (id, ts, actor_email, action, ip, user_agent, request_id, meta_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    ts,
    actorEmail,
    String(action || ""),
    ip,
    userAgent,
    requestId,
    meta ? JSON.stringify(meta) : null
  );
  return id;
}

function listAuditEvents({
  sinceTs = null,
  untilTs = null,
  actorEmail = null,
  action = null,
  limit = 200,
} = {}) {
  const db = getDb();
  const clauses = [];
  const args = [];

  if (Number.isFinite(sinceTs)) {
    clauses.push("ts >= ?");
    args.push(Number(sinceTs));
  }
  if (Number.isFinite(untilTs)) {
    clauses.push("ts <= ?");
    args.push(Number(untilTs));
  }
  if (actorEmail) {
    clauses.push("actor_email = ?");
    args.push(String(actorEmail));
  }
  if (action) {
    clauses.push("action = ?");
    args.push(String(action));
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const lim = Math.min(1000, Math.max(1, Number(limit) || 200));

  const rows = db
    .prepare(
      `SELECT id, ts, actor_email AS actorEmail, action, ip, user_agent AS userAgent, request_id AS requestId, meta_json AS metaJson
       FROM audit_events
       ${where}
       ORDER BY ts DESC
       LIMIT ?`
    )
    .all(...args, lim);

  return (rows || []).map((r) => {
    let meta = null;
    try { meta = r.metaJson ? JSON.parse(String(r.metaJson)) : null; } catch { meta = null; }
    return {
      id: String(r.id),
      ts: Number(r.ts) || 0,
      actorEmail: r.actorEmail ? String(r.actorEmail) : null,
      action: String(r.action || ""),
      ip: r.ip ? String(r.ip) : null,
      userAgent: r.userAgent ? String(r.userAgent) : null,
      requestId: r.requestId ? String(r.requestId) : null,
      meta,
    };
  });
}

module.exports = {
  normalizeEmail,
  deleteExpiredSessions,
  deleteExpiredIdempotencyKeys,
  deleteExpiredRateLimits,
  deleteExpiredLoginFailures,
  consumeRateLimit,
  getLoginLockout,
  recordLoginFailure,
  clearLoginFailures,
  listActiveLoginLockouts,
  createSession,
  getSession,
  rotateSession,
  deleteSession,
  getUser,
  createUser,
  listTransactions,
  transferPoints,
  getIdempotencyResult,
  putIdempotencyResult,
  appendAuditEvent,
  listAuditEvents,
};


