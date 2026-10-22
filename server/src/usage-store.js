import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export function createUsageStore(databasePath) {
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const db = new Database(databasePath);
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  if (databasePath !== ":memory:") db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS installations (
      client_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_usage (
      client_id TEXT NOT NULL REFERENCES installations(client_id) ON DELETE CASCADE,
      usage_date TEXT NOT NULL,
      requests INTEGER NOT NULL DEFAULT 0 CHECK (requests >= 0),
      PRIMARY KEY (client_id, usage_date)
    );

    CREATE INDEX IF NOT EXISTS daily_usage_date_idx ON daily_usage(usage_date);
  `);

  const deleteOldUsage = db.prepare("DELETE FROM daily_usage WHERE usage_date < ?");
  const deleteInactiveInstallations = db.prepare("DELETE FROM installations WHERE last_seen_at < ?");
  const pruneTransaction = db.transaction(({ usageCutoff, installationCutoff }) => {
    deleteOldUsage.run(usageCutoff);
    deleteInactiveInstallations.run(installationCutoff);
  });

  function pruneOldRecords(now = new Date()) {
    const usageCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const installationCutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
    pruneTransaction({ usageCutoff, installationCutoff });
  }

  pruneOldRecords();

  const touchInstallation = db.prepare(`
    INSERT INTO installations (client_id, created_at, last_seen_at)
    VALUES (@clientId, @now, @now)
    ON CONFLICT(client_id) DO UPDATE SET last_seen_at = excluded.last_seen_at
  `);

  const incrementUsage = db.prepare(`
    INSERT INTO daily_usage (client_id, usage_date, requests)
    VALUES (@clientId, @usageDate, 1)
    ON CONFLICT(client_id, usage_date) DO UPDATE SET requests = requests + 1
    WHERE requests < @dailyLimit
  `);

  const reserveTransaction = db.transaction(({ clientId, usageDate, now, dailyLimit }) => {
    touchInstallation.run({ clientId, now });
    return incrementUsage.run({ clientId, usageDate, dailyLimit }).changes === 1;
  });

  const readUsage = db.prepare(`
    SELECT requests FROM daily_usage WHERE client_id = ? AND usage_date = ?
  `);

  const releaseUsage = db.prepare(`
    UPDATE daily_usage SET requests = CASE WHEN requests > 0 THEN requests - 1 ELSE 0 END
    WHERE client_id = ? AND usage_date = ?
  `);

  return {
    reserve({ clientId, usageDate, now, dailyLimit }) {
      return reserveTransaction({ clientId, usageDate, now, dailyLimit });
    },
    release({ clientId, usageDate }) {
      releaseUsage.run(clientId, usageDate);
    },
    getUsed(clientId, usageDate) {
      return readUsage.get(clientId, usageDate)?.requests ?? 0;
    },
    pruneOldRecords,
    close() {
      db.close();
    },
  };
}
