import { fileURLToPath } from "node:url";
import type { Db } from "./client";
import { createLocalDb } from "./local";

/** In-process Postgres with every migration applied. For tests only (never bundled). */
export function createTestDb(): Promise<Db> {
  return createLocalDb(fileURLToPath(new URL("../drizzle", import.meta.url)));
}
