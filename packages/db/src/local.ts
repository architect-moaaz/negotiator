import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "./client";
import * as schema from "./schema";

/**
 * Embedded Postgres (PGlite) with every migration in `migrationsFolder` applied: in memory when
 * `dataDir` is omitted (tests), or persisted to a folder (local development without Neon). Never used
 * in production. The caller passes the folder because bundlers can't resolve this package's own path.
 */
export async function createLocalDb(migrationsFolder: string, dataDir?: string): Promise<Db> {
  const db = drizzle({ client: dataDir ? new PGlite(dataDir) : new PGlite(), schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}
