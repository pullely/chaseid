import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { D1Binding } from "@saas/db/d1";
import { D1ApiAdapter } from "@saas/db/runner";

// A D1 binding over an in-memory SQLite database with every migration applied
// through the runner's own statement splitter. D1 is SQLite, so SQL that runs
// here runs there — and SQL that does not (the baseline's Postgres CTEs) fails
// here exactly as it fails on D1.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");

export function d1Over(db: DatabaseSync): D1Binding {
  return {
    prepare(query: string) {
      let bound: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          bound = values;
          return statement;
        },
        all<T>() {
          const rows = db.prepare(query).all(...(bound as never[])) as T[];
          return Promise.resolve({ results: rows, success: true });
        },
      };
      return statement;
    },
  } as unknown as D1Binding;
}

export function migratedDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  const dirs = readdirSync(MIGRATIONS_ROOT)
    .filter((d) => existsSync(join(MIGRATIONS_ROOT, d, "up.sql")))
    .sort();
  for (const dir of dirs) {
    const sql = readFileSync(join(MIGRATIONS_ROOT, dir, "up.sql"), "utf8");
    for (const statement of D1ApiAdapter.splitStatements(sql)) db.exec(statement);
  }
  return db;
}
