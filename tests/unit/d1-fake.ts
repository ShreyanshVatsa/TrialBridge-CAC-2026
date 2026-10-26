import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

/** Minimal D1Database stand-in backed by Node's built-in SQLite (real SQL semantics for tests). */
export function createTestD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync("functions/migrations/0001_init.sql", "utf8"));
  const prepare = (sql: string) => {
    let params: unknown[] = [];
    const stmt = {
      bind(...p: unknown[]) {
        params = p;
        return stmt;
      },
      async first<T>() {
        return (db.prepare(sql).get(...(params as never[])) ?? null) as T | null;
      },
      async run() {
        db.prepare(sql).run(...(params as never[]));
        return { success: true };
      },
      async all<T>() {
        return { results: db.prepare(sql).all(...(params as never[])) as T[] };
      },
    };
    return stmt;
  };
  return { prepare } as unknown as D1Database;
}
