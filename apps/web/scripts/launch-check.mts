/**
 * Launch preflight, read-only: missing production settings and unapplied database migrations.
 *   vercel env pull .env.production.check --environment=production
 *   pnpm --filter @ghostcart/web launch:check -- .env.production.check
 * Exits 1 on any blocker. Prints setting names only, never values. Delete the pulled file afterwards.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb } from "@ghostcart/db";
import { sql } from "drizzle-orm";
import { launchProblems } from "../src/lib/launch";

const file = process.argv.slice(2).find((a) => !a.startsWith("-"));
const env: Record<string, string | undefined> = { ...process.env };
if (file) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
}
const problems = launchProblems(env);

const folder = fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url));
const migrations = readdirSync(folder).filter((f) => f.endsWith(".sql")).length;
if (env.DATABASE_URL) {
  try {
    const db = createDb(env.DATABASE_URL);
    const res = await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`).catch(() => ({ rows: [{ n: 0 }] }));
    const applied = Number((res as unknown as { rows: { n: number }[] }).rows?.[0]?.n ?? 0);
    if (applied < migrations) problems.unshift({ level: "blocker", key: "migrations", why: `${applied} of ${migrations} applied: run pnpm --filter @ghostcart/db db:migrate` });
    else console.log(`Database: all ${migrations} migrations applied.`);
  } catch (err) {
    problems.unshift({ level: "blocker", key: "DATABASE_URL", why: `can't connect: ${String(err instanceof Error ? err.message : err).slice(0, 120)}` });
  }
}
for (const p of problems) console.log(`${p.level === "blocker" ? "✗" : "!"} ${p.key}: ${p.why}`);
const blockers = problems.filter((p) => p.level === "blocker").length;
console.log(blockers ? `NOT READY: ${blockers} blocker(s)` : `READY${problems.length ? ` with ${problems.length} warning(s)` : ""}`);
process.exit(blockers ? 1 : 0);
