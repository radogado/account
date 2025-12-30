const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = path.join(__dirname, "..", "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const DB_FILE = path.join(DATA_DIR, "account.db");

let db;

async function ensureDataDir() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
}

function getDb() {
  if (!db) throw new Error("DB not initialized");
  return db;
}

function initSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      salt TEXT NOT NULL,
      hash TEXT NOT NULL,
      points INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      user_agent TEXT,
      ip TEXT,
      FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user
      ON sessions(user_email);

    CREATE INDEX IF NOT EXISTS idx_sessions_expires
      ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT NOT NULL,
      ts TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('in','out')),
      from_email TEXT NOT NULL,
      to_email TEXT NOT NULL,
      points INTEGER NOT NULL,
      user_email TEXT NOT NULL,
      PRIMARY KEY (id, user_email, direction),
      FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_user_ts
      ON transactions(user_email, ts DESC);

    -- Idempotency keys for safe retries (e.g. send-points)
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      user_email TEXT NOT NULL,
      scope TEXT NOT NULL,
      idem_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      status INTEGER NOT NULL,
      response_json TEXT NOT NULL,
      PRIMARY KEY (user_email, scope, idem_key),
      FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_idem_expires
      ON idempotency_keys(expires_at);

    -- Append-only audit trail (local demo; still valuable for "enterprise direction")
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      actor_email TEXT,
      action TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      request_id TEXT,
      meta_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_audit_ts
      ON audit_events(ts DESC);

    -- Fixed-window rate limiting (simple + DB-backed)
    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      window_start INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      count INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_rate_limits_expires
      ON rate_limits(expires_at);

    -- Login failures / lockout (simple, DB-backed)
    CREATE TABLE IF NOT EXISTS login_failures (
      key TEXT PRIMARY KEY,
      first_ts INTEGER NOT NULL,
      last_ts INTEGER NOT NULL,
      count INTEGER NOT NULL,
      locked_until INTEGER NOT NULL,
      lock_level INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_login_failures_locked
      ON login_failures(locked_until);
  `);

  // Lightweight migrations for existing DBs (keep everything "simple node").
  // Add csrf_token to sessions if missing.
  try {
    const cols = db.prepare("PRAGMA table_info(sessions)").all();
    const hasCsrf = Array.isArray(cols) && cols.some((c) => c && c.name === "csrf_token");
    if (!hasCsrf) {
      db.exec("ALTER TABLE sessions ADD COLUMN csrf_token TEXT");
    }
  } catch {
    // ignore
  }

  // Add lock_level to login_failures if missing.
  try {
    const cols = db.prepare("PRAGMA table_info(login_failures)").all();
    const hasLockLevel = Array.isArray(cols) && cols.some((c) => c && c.name === "lock_level");
    if (!hasLockLevel) {
      db.exec("ALTER TABLE login_failures ADD COLUMN lock_level INTEGER NOT NULL DEFAULT 0");
    }
  } catch {
    // ignore
  }
}

async function maybeImportFromUsersJson(db) {
  // Only import if DB is empty.
  const row = db.prepare("SELECT COUNT(*) AS n FROM users").get();
  if ((row?.n || 0) > 0) return;

  try {
    await fsp.access(USERS_FILE, fs.constants.F_OK);
  } catch {
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(await fsp.readFile(USERS_FILE, "utf8"));
  } catch {
    return;
  }
  const users = parsed?.users && typeof parsed.users === "object" ? parsed.users : {};
  const emails = Object.keys(users);
  if (!emails.length) return;

  db.exec("BEGIN IMMEDIATE");
  try {
    const insUser = db.prepare(
      "INSERT INTO users (email, salt, hash, points, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    const insTx = db.prepare(
      "INSERT OR IGNORE INTO transactions (id, ts, direction, from_email, to_email, points, user_email) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );

    for (const email of emails) {
      const u = users[email];
      if (!u?.email || !u?.salt || !u?.hash) continue;
      const createdAt = u.createdAt || new Date().toISOString();
      const points = Number.isFinite(u.points) ? Math.trunc(u.points) : 0;

      insUser.run(String(u.email), String(u.salt), String(u.hash), points, String(createdAt));

      const txs = Array.isArray(u.transactions) ? u.transactions : [];
      for (const tx of txs) {
        if (!tx?.id || !tx?.ts) continue;
        const direction = tx.direction === "in" ? "in" : "out";
        insTx.run(
          String(tx.id),
          String(tx.ts),
          direction,
          String(tx.from || ""),
          String(tx.to || ""),
          Math.trunc(Number(tx.points) || 0),
          String(u.email)
        );
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    throw e;
  }
}

async function initDb() {
  await ensureDataDir();
  db = new DatabaseSync(DB_FILE);
  initSchema(db);
  await maybeImportFromUsersJson(db);
  return db;
}

module.exports = {
  initDb,
  getDb,
  DB_FILE,
};


