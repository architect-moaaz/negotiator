import { schema } from "@ghostcart/db";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { trialBalance } from "@/lib/orders/ledger";
import { heldFor } from "@/lib/orders/service";
import { settlementGateway } from "@/lib/orders/settlement";
import { requireStaff } from "@/lib/staff";

/**
 * Ledger health and reconciliation: the ledger must sum to zero, every transaction too, and what we
 * hold per order must match what the settlement gateway says it holds.
 */
export async function GET(request: Request) {
  const { denied } = await requireStaff(request, "finance");
  if (denied) return denied;
  const db = await getDb();
  const tb = await trialBalance(db);
  const gateway = settlementGateway();
  const recent = await db.select().from(schema.holds).orderBy(desc(schema.holds.updatedAt)).limit(200);
  const mismatches = [];
  if (gateway) {
    for (const h of recent) {
      const [order] = await db.select({ id: schema.orders.id, storeId: schema.orders.storeId }).from(schema.orders).where(eq(schema.orders.id, h.orderId));
      if (!order) continue;
      const ours = await heldFor(order);
      const theirs = await gateway.settlements(h.orderId);
      const expectHeld = h.state === "held" || h.state === "frozen" ? ours.sellerShare : 0;
      if (theirs.held !== expectHeld) mismatches.push({ orderId: h.orderId, state: h.state, ledgerHeld: expectHeld, gatewayHeld: theirs.held });
    }
  }
  return Response.json(
    { balanced: tb.total === 0 && tb.unbalanced.length === 0, total: tb.total, unbalanced: tb.unbalanced, accounts: tb.accounts, gateway: gateway?.name ?? null, checked: recent.length, mismatches },
    { headers: { "Cache-Control": "no-store" } },
  );
}
