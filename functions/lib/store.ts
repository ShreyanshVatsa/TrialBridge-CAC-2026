/**
 * Tiny key-value store with TTL and atomic counters, used for the analysis cache, rate limits,
 * and provider budgets. Production: D1 (`kv` table). Tests: in-memory.
 * Only hash keys and outputs are stored; never raw IPs, profiles, or questions.
 */
export interface KvStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** Atomically add `by` (default 1) to a counter (creating it with the TTL if absent/expired); returns the new value. */
  incr(key: string, ttlSeconds: number, by?: number): Promise<number>;
}

const nowSec = () => Math.floor(Date.now() / 1000);

export class D1KvStore implements KvStore {
  constructor(private readonly db: D1Database) {}

  async get(key: string): Promise<string | null> {
    const row = await this.db.prepare("SELECT value FROM kv WHERE key = ? AND expires_at > ?").bind(key, nowSec()).first<{ value: string }>();
    return row?.value ?? null;
  }

  async put(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.db
      .prepare("INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at")
      .bind(key, value, nowSec() + ttlSeconds)
      .run();
  }

  async incr(key: string, ttlSeconds: number, by = 1): Promise<number> {
    const now = nowSec();
    const step = Math.max(0, Math.floor(by));
    const row = await this.db
      .prepare(
        `INSERT INTO kv (key, value, expires_at) VALUES (?1, CAST(?4 AS TEXT), ?2)
         ON CONFLICT(key) DO UPDATE SET
           value = CASE WHEN kv.expires_at <= ?3 THEN CAST(?4 AS TEXT) ELSE CAST(CAST(kv.value AS INTEGER) + ?4 AS TEXT) END,
           expires_at = CASE WHEN kv.expires_at <= ?3 THEN ?2 ELSE kv.expires_at END
         RETURNING value`,
      )
      .bind(key, now + ttlSeconds, now, step)
      .first<{ value: string }>();
    return Number(row?.value ?? step);
  }

  /** Remove expired rows (called occasionally via waitUntil). */
  async purgeExpired(): Promise<void> {
    await this.db.prepare("DELETE FROM kv WHERE expires_at <= ?").bind(nowSec()).run();
  }
}

export class MemoryKvStore implements KvStore {
  private readonly map = new Map<string, { value: string; expires: number }>();
  constructor(private readonly clock: () => number = () => Date.now()) {}

  private live(key: string) {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.expires <= this.clock()) {
      this.map.delete(key);
      return null;
    }
    return e;
  }
  async get(key: string) {
    return this.live(key)?.value ?? null;
  }
  async put(key: string, value: string, ttlSeconds: number) {
    this.map.set(key, { value, expires: this.clock() + ttlSeconds * 1000 });
  }
  async incr(key: string, ttlSeconds: number, by = 1) {
    const e = this.live(key);
    const next = (e ? Number(e.value) : 0) + Math.max(0, Math.floor(by));
    this.map.set(key, { value: String(next), expires: e?.expires ?? this.clock() + ttlSeconds * 1000 });
    return next;
  }
  get size() {
    return this.map.size;
  }
}
