import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/** Any Drizzle Postgres database with our schema: Neon over HTTP in the app, PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Neon over HTTP: one round trip per query, no pool to manage on serverless. */
export function createDb(url: string): Db {
  return drizzle({ client: neon(url), schema }) as unknown as Db;
}
