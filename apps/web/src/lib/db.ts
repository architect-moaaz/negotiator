import { createDb, type Db } from "@ghostcart/db";
import path from "node:path";

/**
 * The Postgres database for seller data (orgs, stores, catalogue, policies and, later, payments).
 * Neon when DATABASE_URL is set. Without it, local development and tests use an embedded Postgres
 * (persisted in apps/web/.pglite, or in memory under Vitest); production refuses to run without Neon.
 */
export class DatabaseUnavailableError extends Error {
  constructor() {
    super("Seller tools need a database: set DATABASE_URL.");
  }
}

const g = globalThis as typeof globalThis & { __ghostcartDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (g.__ghostcartDb) return g.__ghostcartDb;
  if (process.env.DATABASE_URL) return (g.__ghostcartDb = Promise.resolve(createDb(process.env.DATABASE_URL)));
  if (process.env.VERCEL_ENV === "production") return Promise.reject(new DatabaseUnavailableError());
  // Vitest and next dev both run from apps/web.
  const migrations = path.resolve(process.cwd(), "../../packages/db/drizzle");
  g.__ghostcartDb = import("@ghostcart/db/local").then(({ createLocalDb }) => createLocalDb(migrations, process.env.VITEST ? undefined : ".pglite"));
  return g.__ghostcartDb;
}
