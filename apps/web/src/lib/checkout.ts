import { inr } from "./format";
import { BALANCE_REF_SUFFIX, createBalancePayment, PaymentsUnavailableError } from "./payments";
import { createOrderFromDeal } from "./orders/service";
import { takeStock } from "./shop/products";
import { store } from "./store";
import { normalizePhone } from "./users";
import { FULFILMENT_STAGES } from "./fulfilment";
import type { Deal, DeliveryAddress, PublicCheckout } from "./types";

export const CHECKOUT_WINDOW_MS = Number(process.env.CHECKOUT_WINDOW_MINUTES ?? 30) * 60 * 1000;
// A UPI payment made in the last seconds of the window still counts.
export const CHECKOUT_GRACE_MS = 30_000;
const DELIVERY_DAYS = Number(process.env.DELIVERY_DAYS ?? 3);

export class CheckoutError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const log = (deal: Deal, type: "checkout_opened" | "address_received" | "payment_link_created" | "order_placed" | "checkout_lapsed" | "order_status", detail: string, actor: "user" | "system" = "system") =>
  store.log({ type, actor, userId: deal.userId, dealId: deal.id, detail });

/** Lock fee paid: start the 30-minute window for the delivery address and the balance payment. */
export async function openCheckout(deal: Deal) {
  if (deal.checkout) return;
  const now = Date.now();
  deal.checkout = { status: "awaiting", openedAt: now, dueAt: now + CHECKOUT_WINDOW_MS, amount: Math.max(0, deal.dealPrice - deal.lockFee) };
  await log(deal, "checkout_opened", `${CHECKOUT_WINDOW_MS / 60000} min to add a delivery address and pay the ${inr(deal.checkout.amount)} balance`);
}

/** Mark the checkout lapsed once its window (plus grace) has passed. Returns true if the deal changed. */
export async function syncCheckout(deal: Deal) {
  const c = deal.checkout;
  if (c?.status !== "awaiting" || Date.now() < c.dueAt + CHECKOUT_GRACE_MS) return false;
  c.status = "lapsed";
  await store.saveDeal(deal);
  await log(deal, "checkout_lapsed", `Checkout window ended without ${c.address ? "the balance payment" : "a delivery address"}; price lock released`);
  return true;
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Validate a delivery address from the browser. Throws CheckoutError with a shopper-facing message. */
export function parseAddress(raw: Record<string, unknown>): DeliveryAddress {
  const name = clean(raw.name, 80);
  const line1 = clean(raw.line1, 160);
  const city = clean(raw.city, 60);
  const state = clean(raw.state, 60);
  const pincode = clean(raw.pincode, 6);
  const phone = normalizePhone(clean(raw.phone, 20));
  if (name.length < 2) throw new CheckoutError("Add the name of the person receiving the parcel.");
  if (!phone) throw new CheckoutError("Enter a 10-digit Indian mobile number for the delivery partner.");
  if (line1.length < 5) throw new CheckoutError("Add your house or flat number and street.");
  if (city.length < 2 || state.length < 2) throw new CheckoutError("Add your city and state.");
  if (!/^[1-9]\d{5}$/.test(pincode)) throw new CheckoutError("Enter a valid 6-digit pincode.");
  return { name, phone, line1, line2: clean(raw.line2, 160) || undefined, landmark: clean(raw.landmark, 80) || undefined, city, state, pincode };
}

/** Save (or correct) the delivery address and issue the balance payment. */
export async function saveAddress(deal: Deal, address: DeliveryAddress) {
  await syncCheckout(deal);
  const c = deal.checkout;
  if (deal.status !== "paid" || !c) throw new CheckoutError("Lock the deal before adding an address.", 409);
  if (c.status === "lapsed") throw new CheckoutError("The 30 minutes ran out, so the price lock was released.", 409);
  if (c.status === "ordered") throw new CheckoutError("This order is already placed.", 409);

  const first = !c.address;
  Object.assign(c, { address, addressAt: Date.now() });
  await log(deal, "address_received", `${first ? "Delivery address added" : "Delivery address updated"}: ${address.city}, ${address.state} ${address.pincode}`, "user");

  if (c.amount === 0) return placeOrder(deal, "no balance due");
  if (!c.upiIntent && !c.qrDataUrl) {
    try {
      Object.assign(c, await createBalancePayment({ dealId: deal.id, title: deal.product.title, amountInr: c.amount }));
    } catch (err) {
      if (!(err instanceof PaymentsUnavailableError)) throw err;
      await store.saveDeal(deal); // keep the address; the payment can be issued on the next try
      await log(deal, "payment_link_created", `No balance payment for ${inr(c.amount)}: ${err.message}`);
      throw new CheckoutError("Your address is saved, but payments are paused right now. Try again in a few minutes.", 503);
    }
    await log(deal, "payment_link_created", `Pine Labs UPI order ${c.pinelabsOrderId} for the ${inr(c.amount)} balance`);
  }
  return store.saveDeal(deal);
}

/** Balance paid: place the order. Idempotent across pollers and the webhook. */
export async function placeOrder(deal: Deal, source: string) {
  const c = deal.checkout;
  if (!c || c.status === "ordered") return deal;
  if (!c.address) throw new CheckoutError("Add a delivery address first.", 409);
  if (Date.now() > c.dueAt + CHECKOUT_GRACE_MS) throw new CheckoutError("The 30 minutes ran out, so the price lock was released.", 409);
  if (!(await store.claimPaid(`${deal.id}${BALANCE_REF_SUFFIX}`))) return deal;

  const now = Date.now();
  Object.assign(c, {
    status: "ordered",
    paidAt: now,
    orderRef: `GC-${deal.id.slice(0, 6).toUpperCase()}`,
    deliveryBy: now + DELIVERY_DAYS * 24 * 60 * 60 * 1000,
    tracking: [{ stage: "placed", at: now }],
  });
  await store.saveDeal(deal);
  if (deal.shop) {
    await takeStock(deal.shop.productId);
    try {
      await createOrderFromDeal(deal);
    } catch (err) {
      // The buyer has paid; never fail their checkout over this. Staff see it in the log and fix it.
      console.error("shop order record failed", err);
      await log(deal, "order_status", `ATTENTION: paid shop deal has no order record yet: ${String(err).slice(0, 200)}`);
    }
  }
  await log(
    deal,
    "order_placed",
    `${source}: ${inr(c.amount)} balance paid${c.pinelabsOrderId ? ` (Pine Labs order ${c.pinelabsOrderId})` : ""}; order ${c.orderRef} for ${deal.product.title} to ${c.address.city} ${c.address.pincode}`,
  );
  return deal;
}

/** Move an order to its next delivery stage (deal desk / seller action). Courier details are recorded when it ships. */
export async function advanceOrder(deal: Deal, { courier, awb, by }: { courier?: string; awb?: string; by: string }) {
  const c = deal.checkout;
  if (c?.status !== "ordered" || !c.tracking?.length) throw new CheckoutError("This deal has no placed order.", 409);
  const current = FULFILMENT_STAGES.findIndex((s) => s.stage === c.tracking!.at(-1)!.stage);
  const next = FULFILMENT_STAGES[current + 1];
  if (!next) throw new CheckoutError("This order is already delivered.", 409);

  if (next.stage === "shipped") {
    c.courier = clean(courier, 40) || undefined;
    c.awb = clean(awb, 40) || undefined;
  }
  const note = next.stage === "shipped" && c.courier ? `${c.courier}${c.awb ? ` · AWB ${c.awb}` : ""}` : undefined;
  c.tracking.push({ stage: next.stage, at: Date.now(), note });
  await store.saveDeal(deal);
  await store.log({ type: "order_status", actor: "human", userId: deal.userId, dealId: deal.id, detail: `${c.orderRef} → ${next.label}${note ? ` (${note})` : ""} by ${by}` });
  return deal;
}

export function toPublicCheckout(c: Deal["checkout"]): PublicCheckout | undefined {
  if (!c) return undefined;
  const { address, ...rest } = c;
  delete rest.pinelabsOrderId;
  return { ...rest, deliverTo: address && { name: address.name, area: `${address.city} ${address.pincode}` } };
}
