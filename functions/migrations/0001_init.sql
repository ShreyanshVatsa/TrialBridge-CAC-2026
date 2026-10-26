-- Backend copy of official trial criteria (loaded by ingestion: npm run db:seed:local).
CREATE TABLE IF NOT EXISTS trials (
  nct_id TEXT PRIMARY KEY,
  data_version TEXT NOT NULL,
  payload TEXT NOT NULL
);
-- Generic TTL key-value table: analysis cache (hash keys only), rate-limit and budget counters.
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS kv_expires ON kv (expires_at);
