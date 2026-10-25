import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { store } from "@/lib/store";

/** Liveness for uptime checks: can we reach Postgres and the key-value store? No data is returned. */
export async function GET() {
  const check = async (run: () => Promise<unknown>) => {
    try {
      await run();
      return "ok";
    } catch {
      return "unavailable";
    }
  };
  const [db, kv] = await Promise.all([
    check(async () => (await getDb()).execute(sql`select 1`)),
    check(() => store.kvGet("health:probe")),
  ]);
  const ok = db === "ok" && kv === "ok";
  return Response.json({ ok, db, kv }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
