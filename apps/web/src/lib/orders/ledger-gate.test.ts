import { accounts } from "@ghostcart/core";
import { schema } from "@ghostcart/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { placeOrder, saveAddress } from "../checkout";
import { getDb } from "../db";
import { acceptOffer, markPaid } from "../negotiate";
import { startShopNegotiation } from "../shop/negotiation";
import { createOrg } from "../shop/orgs";
import { setPolicy } from "../shop/policies";
import { createProduct } from "../shop/products";
import { createStore, updateStore } from "../shop/stores";
import { openDispute } from "./fulfilment";
import { post } from "./ledger";
import { ledgerGate } from "./ledger-gate";
import { heldFor, markDelivered, orderForDeal, refundOrder, runOrderJobs } from "./service";

let n = 0;
async function paidOrder(tier: "new" | "verified" = "verified") {
  const org = await createOrg({ name: "ZZ Gate", ownerPhone: `+9190000077${String(++n).padStart(2, "0")}`, ownerName: "ZZ" });
  const s = (await updateStore((await createStore({ orgId: org.id, name: "ZZ Gate Store", platform: "ghostcart_shop" })).id, { status: "live", tier }))!;
  await setPolicy(s.id, "store", null, { maxDiscountPct: 10, autoApprovePct: 5 });
  const product = await createProduct(s.id, { title: "ZZ Gate Item", price: 10000, stock: 5 });
  let deal = await startShopNegotiation(product.id, `gate-buyer-${n}`);
  deal = await acceptOffer(deal);
  deal = await markPaid(deal, "pinelabs");
  deal = await saveAddress(deal, { name: "ZZ Buyer", phone: "+919000007799", line1: `${n} ZZ Gate Street`, city: "Bengaluru", state: "Karnataka", pincode: "560038" });
  deal = await placeOrder(deal, "pinelabs");
  return (await orderForDeal(deal.id))!;
}

const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);
/** The gate's problems for these orders (other tests share the database). */
async function problemsFor(...orderIds: string[]) {
  const gate = await ledgerGate(await getDb(), { graceMs: 0 });
  return gate.problems.filter((p) => p.orderId && orderIds.includes(p.orderId));
}

describe("ledger gate", () => {
  it("passes every order lifecycle: held, released, partial refund then release, full refund, cancelled, disputed", async () => {
    const held = await paidOrder();

    const released = await paidOrder();
    await markDelivered(released.id, "test", daysAgo(4));

    const partial = await paidOrder();
    await refundOrder(partial.id, 50_000, "ZZ partial", "ZZ Staff");
    await markDelivered(partial.id, "test", daysAgo(4));

    const full = await paidOrder();
    const h = await heldFor(full);
    await refundOrder(full.id, h.sellerShare + h.fee + h.gst, "ZZ returned", "ZZ Staff");

    const unshipped = await paidOrder();
    await (await getDb()).update(schema.orders).set({ shipBy: daysAgo(1) }).where(eq(schema.orders.id, unshipped.id));

    const disputed = await paidOrder("new");
    await markDelivered(disputed.id, "test");
    await openDispute(disputed.id, { reason: "damaged", details: "ZZ test: the lid was cracked on arrival." });

    const { released: rel, cancelled } = await runOrderJobs();
    expect(rel).toEqual(expect.arrayContaining([released.id, partial.id]));
    expect(cancelled).toContain(unshipped.id);

    // A fee posting with no order (price grants) is fine too.
    await post(await getDb(), { kind: "grant_fee", postings: [{ account: accounts.sellerFeesDue(held.storeId), amount: 236 }, { account: accounts.fee, amount: -200 }, { account: accounts.gst, amount: -36 }] });

    expect(await problemsFor(held.id, released.id, partial.id, full.id, unshipped.id, disputed.id)).toEqual([]);
    const gate = await ledgerGate(await getDb(), { graceMs: 0 });
    expect(gate.total).toBe(0);
    expect(gate.problems.filter((p) => !p.orderId)).toEqual([]);
  });

  it("catches a release posted twice, a paid amount that doesn't match the order, and a missing hold", async () => {
    const db = await getDb();
    const twice = await paidOrder();
    await markDelivered(twice.id, "test", daysAgo(4));
    await runOrderJobs();
    // Replay the release postings by hand: the hold goes negative and money is double-counted.
    await post(db, {
      orderId: twice.id,
      kind: "released",
      postings: [
        { account: accounts.sellerHeld(twice.storeId), amount: twice.sellerShare },
        { account: accounts.sellerPayable(twice.storeId), amount: -twice.sellerShare },
      ],
    });
    const checks = (await problemsFor(twice.id)).map((p) => p.check);
    expect(checks).toEqual(expect.arrayContaining(["over_released", "released_twice", "hold_state"]));

    // Held money moved to an account that isn't a refund, a release or a hold: it has leaked.
    const leak = await paidOrder();
    await post(db, { orderId: leak.id, kind: "adjustment", postings: [{ account: accounts.sellerHeld(leak.storeId), amount: 1_000 }, { account: "ghostcart:suspense", amount: -1_000 }] });
    expect((await problemsFor(leak.id)).map((p) => p.check)).toEqual(expect.arrayContaining(["conservation", "hold_amount"]));

    const wrong = await paidOrder();
    await db.update(schema.orders).set({ total: wrong.total + 100 }).where(eq(schema.orders.id, wrong.id));
    expect((await problemsFor(wrong.id)).map((p) => p.check)).toEqual(expect.arrayContaining(["order_split", "paid_amount"]));

    const noHold = await paidOrder();
    await db.delete(schema.holds).where(eq(schema.holds.orderId, noHold.id));
    expect((await problemsFor(noHold.id)).map((p) => p.check)).toContain("hold_missing");
  });

  it("catches status drift, refunds that don't match, posting to another store, and a missing payment", async () => {
    const db = await getDb();
    const drift = await paidOrder();
    await db.update(schema.orders).set({ status: "completed" }).where(eq(schema.orders.id, drift.id));
    expect((await problemsFor(drift.id)).map((p) => p.check)).toContain("order_status");

    const refund = await paidOrder();
    await refundOrder(refund.id, 10_000, "ZZ partial", "ZZ Staff");
    await db.update(schema.refunds).set({ amount: 20_000 }).where(eq(schema.refunds.orderId, refund.id));
    expect((await problemsFor(refund.id)).map((p) => p.check)).toContain("refunds_table");

    const a = await paidOrder();
    const b = await paidOrder();
    await post(db, { orderId: a.id, kind: "adjustment", postings: [{ account: accounts.sellerHeld(b.storeId), amount: 100 }, { account: accounts.sellerHeld(a.storeId), amount: -100 }] });
    expect((await problemsFor(a.id)).map((p) => p.check)).toContain("foreign_account");

    const unpaid = await paidOrder();
    await db.delete(schema.ledgerEntries).where(eq(schema.ledgerEntries.orderId, unpaid.id));
    expect((await problemsFor(unpaid.id)).map((p) => p.check)).toContain("paid_count");
    // ...but a just-placed order is given time to finish writing.
    expect((await ledgerGate(db)).skipped).toContain(unpaid.id);
  });

  it("catches an unbalanced or mixed transaction anywhere in the ledger", async () => {
    const db = await getDb();
    const o = await paidOrder();
    await db.insert(schema.ledgerEntries).values({ txnId: "txn_zz_unbalanced", orderId: o.id, kind: "adjustment", account: accounts.feeHeld, amount: 5 });
    await db.insert(schema.ledgerEntries).values([
      { txnId: "txn_zz_mixed", orderId: o.id, kind: "adjustment", account: accounts.fee, amount: 7 },
      { txnId: "txn_zz_mixed", orderId: null, kind: "adjustment", account: accounts.gst, amount: -7 },
    ]);
    const gate = await ledgerGate(db, { graceMs: 0 });
    expect(gate.ok).toBe(false);
    expect(gate.problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: "ledger_total" }),
        expect.objectContaining({ check: "txn_unbalanced", txnId: "txn_zz_unbalanced" }),
        expect.objectContaining({ check: "txn_mixed", txnId: "txn_zz_mixed" }),
      ]),
    );
  });
});
