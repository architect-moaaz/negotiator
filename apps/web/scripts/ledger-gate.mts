/**
 * Release gate: the ledger must agree with itself and with every order (see src/lib/orders/ledger-gate.ts).
 * Run against production (read-only) before shipping any change that touches money, and after deploying:
 *   pnpm --filter @ghostcart/web db:ledger-gate
 * Exits 1 and lists the problems if anything is off. Needs DATABASE_URL.
 */
import { createDb } from "@ghostcart/db";
import { ledgerGate } from "../src/lib/orders/ledger-gate";

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL.");
  process.exit(2);
}
const gate = await ledgerGate(createDb(process.env.DATABASE_URL));
console.log(`Ledger gate: ${gate.checked} orders checked, ${gate.skipped.length} still being written, ledger total ${gate.total} paise.`);
for (const p of gate.problems) console.log(`  ✗ ${p.check}${p.orderId ? ` ${p.orderId}` : ""}${p.txnId ? ` ${p.txnId}` : ""}: ${p.detail}`);
console.log(gate.ok ? "PASS" : `FAIL: ${gate.problems.length} problem(s)`);
process.exit(gate.ok ? 0 : 1);
