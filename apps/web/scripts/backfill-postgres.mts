/**
 * Make Postgres an exact copy of Redis. Run while STORE_MODE=dual (Redis is still the source of truth
 * and every new write is already mirrored), then switch to STORE_MODE=postgres.
 *
 *   pnpm --filter @ghostcart/web db:backfill            # dry run: counts only
 *   pnpm --filter @ghostcart/web db:backfill --confirm  # write
 *
 * Needs KV_REST_API_URL, KV_REST_API_TOKEN and DATABASE_URL. Safe to re-run: rows are upserted, and the
 * activity log, visits, counters and demand are replaced wholesale from Redis.
 * Before writing, the activity log is exported to backfill-export-<time>.json (gitignored) as the record.
 */
import { createDb, schema } from "@ghostcart/db";
import { Redis } from "@upstash/redis";
import { writeFileSync } from "node:fs";
import { createPgStore } from "../src/lib/pg-store";
import { legacyStore } from "../src/lib/store";

const { KV_REST_API_URL, KV_REST_API_TOKEN, DATABASE_URL } = process.env;
if (!KV_REST_API_URL || !KV_REST_API_TOKEN || !DATABASE_URL) {
  console.error("Set KV_REST_API_URL, KV_REST_API_TOKEN and DATABASE_URL.");
  process.exit(1);
}
const confirm = process.argv.includes("--confirm");
const redis = new Redis({ url: KV_REST_API_URL, token: KV_REST_API_TOKEN });
const db = createDb(DATABASE_URL);
const pg = createPgStore(db);
const ALL = 1_000_000;

async function scanKeys(match: string) {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(cursor, { match, count: 500 });
    cursor = String(next);
    keys.push(...batch);
  } while (cursor !== "0");
  return keys;
}

async function inChunks<T>(rows: T[], size: number, write: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await write(rows.slice(i, i + size));
}

const [users, sellers, deals, log, visits, stats, demand, tokenKeys] = await Promise.all([
  legacyStore.listUsers(ALL),
  legacyStore.listSellers(),
  legacyStore.listDeals(ALL),
  legacyStore.listLog(ALL),
  legacyStore.listVisits(ALL),
  legacyStore.stats(),
  legacyStore.topDemand(ALL),
  scanKeys("sellerToken:*"),
]);
console.table({ users: users.length, sellers: sellers.length, sellerTokens: tokenKeys.length, deals: deals.length, activity: log.length, visits: visits.length, demand: demand.length });
console.log("counters", stats);

if (!confirm) {
  console.log("Dry run. Re-run with --confirm to write to Postgres.");
  process.exit(0);
}

const exportFile = `backfill-export-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(exportFile, JSON.stringify({ exportedAt: Date.now(), stats, activity: log }, null, 2));
console.log(`Activity log exported to ${exportFile}`);

for (const u of users) await pg.updateUser(u);
for (const s of sellers) await pg.saveSeller(s);
for (const key of tokenKeys) {
  const sellerId = await redis.get<string>(key);
  if (sellerId && sellers.some((s) => s.id === sellerId)) {
    await db.insert(schema.sellerTokens).values({ tokenHash: key.slice("sellerToken:".length), sellerId }).onConflictDoNothing();
  }
}
for (const d of deals) await pg.saveDeal(d);

// Lists come back newest first; insert oldest first so identity order matches time order.
await db.delete(schema.activity);
await inChunks([...log].reverse(), 500, (chunk) =>
  db.insert(schema.activity).values(chunk.map((a) => ({ ...a, at: new Date(a.at), userId: a.userId ?? null, dealId: a.dealId ?? null }))),
);
await db.delete(schema.visits);
await inChunks([...visits].reverse(), 500, (chunk) =>
  db.insert(schema.visits).values(chunk.map(({ vid, path, at, ...data }) => ({ vid, path, at: new Date(at), data }))),
);
await db.delete(schema.counters);
await db.insert(schema.counters).values(Object.entries(stats).map(([key, value]) => ({ key, value })));
await db.delete(schema.sellerDemand);
await inChunks(demand, 500, (chunk) => db.insert(schema.sellerDemand).values(chunk));

console.log("Backfill complete. Spot-check /admin, then set STORE_MODE=postgres.");
