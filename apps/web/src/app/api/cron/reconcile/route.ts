import { cronAuthorized } from "@/lib/cron";
import { getDb } from "@/lib/db";
import { ledgerGate } from "@/lib/orders/ledger-gate";
import { nightlyReconciliation } from "@/lib/orders/reconcile";
import { log } from "@/lib/telemetry";

/**
 * Vercel Cron, 01:00 IST: match yesterday's (and the day before's) settlement report against the ledger,
 * then run the ledger gate over every order. A broken gate is logged as an error and reported to Sentry.
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return new Response("unauthorized", { status: 401 });
  const out = await nightlyReconciliation();
  const gate = await ledgerGate(await getDb());
  if (!gate.ok) {
    log("error", "ledger gate failed", { problems: gate.problems.length, checks: [...new Set(gate.problems.map((p) => p.check))], first: gate.problems.slice(0, 5) });
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureMessage(`Ledger gate failed: ${gate.problems.length} problem(s)`, { level: "error", extra: { problems: gate.problems.slice(0, 20) } });
  }
  return Response.json({
    reconciliation: out.map((r) => ({ day: r!.run.day, matched: r!.run.matched, issues: r!.run.issues })),
    ledger: { ok: gate.ok, checked: gate.checked, problems: gate.problems.length },
  });
}
