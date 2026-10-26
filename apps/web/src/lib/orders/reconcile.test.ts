import { describe, expect, it } from "vitest";
import { placeOrder, saveAddress } from "../checkout";
import { acceptOffer, markPaid } from "../negotiate";
import { startShopNegotiation } from "../shop/negotiation";
import { createOrg } from "../shop/orgs";
import { createProduct } from "../shop/products";
import { createStore, updateStore } from "../shop/stores";
import { store as kv } from "../store";
import { istDay } from "../warehouse";
import { confirmReceivedByBuyer, markShipped } from "./fulfilment";
import { heldFor, orderForDeal, refundOrder, releaseOrder } from "./service";
import { reconcileDay, reconciliationStatus, resolveIssue } from "./reconcile";
import type { SettlementLine } from "./settlement";

let n = 0;
async function paidOrder() {
  const org = await createOrg({ name: "ZZ Recon", ownerPhone: `+9190000098${String(++n).padStart(2, "0")}`, ownerName: "ZZ" });
  const s = (await updateStore((await createStore({ orgId: org.id, name: "ZZ Recon Store", platform: "ghostcart_shop" })).id, { status: "live", tier: "trusted" }))!;
  const p = await createProduct(s.id, { title: "ZZ Recon Item", price: 2500, stock: 3 });
  let deal = await startShopNegotiation(p.id, `zz-recon-buyer-${n}`);
  deal = await acceptOffer(deal);
  deal = await markPaid(deal, "pinelabs");
  deal = await saveAddress(deal, { name: "ZZ Buyer", phone: "+919000009899", line1: `${Math.random().toString(36).slice(2, 8)} Recon Lane`, city: "Pune", state: "Maharashtra", pincode: "411001" });
  deal = await placeOrder(deal, "pinelabs");
  return (await orderForDeal(deal.id))!;
}

describe("settlement reconciliation", () => {
  it("matches holds, releases and refunds to the paisa, and turns differences into issues finance can resolve", async () => {
    const day = istDay(Date.now());
    const released = await paidOrder();
    await markShipped(released.id, { courier: "Delhivery", awb: `ZZREC${n}` }, "seller");
    await confirmReceivedByBuyer(released.id);
    await releaseOrder(released.id);
    const refunded = await paidOrder();
    const held = await heldFor(refunded);
    await refundOrder(refunded.id, held.sellerShare + held.fee + held.gst, "ZZ test: seller cancelled", "zz-test", "cancelled");

    const clean = (await reconcileDay(day))!;
    expect(clean.issues.filter((i) => [released.id, refunded.id].includes(i.orderId))).toEqual([]);

    // The aggregator reports a release we never made, and skips nothing else.
    const report = (await kv.kvGet<SettlementLine[]>(`settle:report:${day}`))!;
    await kv.kvSet(`settle:report:${day}`, [...report, { orderId: refunded.id, kind: "release", amount: 12345, ref: "zz-bogus", at: new Date().toISOString() }]);
    const dirty = (await reconcileDay(day))!;
    const issue = dirty.issues.find((i) => i.orderId === refunded.id)!;
    expect(issue).toMatchObject({ kind: "release", ledgerAmount: 0, gatewayAmount: 12345 });

    const { open } = await reconciliationStatus();
    const row = open.find((o) => o.orderId === refunded.id)!;
    await expect(resolveIssue(row.id, "ok", "ZZ Finance")).rejects.toThrow();
    await resolveIssue(row.id, "Pine Labs confirmed a duplicate report line; no money moved.", "ZZ Finance");
    await reconcileDay(day); // the same difference again stays resolved, not reopened
    expect((await reconciliationStatus()).open.some((o) => o.orderId === refunded.id)).toBe(false);
  });
});
