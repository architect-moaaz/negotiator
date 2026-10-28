import { schema } from "@ghostcart/db";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { cartsWithContact, eraseCartContact } from "../privilege/carts";
import { store } from "../store";
import type { Deal, User } from "../types";
import { consentHistory, recordConsent } from "./consent";

const { activity, deviceLinks, disputes, grievances, orders } = schema;

/**
 * Orders and payments are books of account: the Companies Act (s.128) keeps them 8 years and GST
 * records 72 months. After erasure we keep them for that long, de-identified: no name, phone or street.
 * Pending legal review, like the rest of the retention schedule.
 */
export const ORDER_RETENTION_YEARS = 8;

/** Orders still in motion: deleting the account would leave a seller unable to ship or a dispute unresolved. */
const OPEN_ORDER = ["placed", "shipped", "delivered", "disputed", "return_requested", "return_accepted"];

export class PrivacyError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

async function dealsFor(userId: string) {
  return (await store.listDeals()).filter((d) => d.userId === userId);
}

/** Everything GhostCart holds about a shopper, in one JSON document (DPDP right to access). */
export async function exportShopperData(user: User) {
  const db = await getDb();
  const [deals, consents, orderRows, grievanceRows, cartRows] = await Promise.all([
    dealsFor(user.id),
    consentHistory(user.id),
    db.select().from(orders).where(eq(orders.userId, user.id)),
    db.select().from(grievances).where(eq(grievances.contact, user.phone)),
    cartsWithContact({ userId: user.id, phone: user.phone, email: user.email }),
  ]);
  const disputeRows = orderRows.length ? await db.select().from(disputes).where(inArray(disputes.orderId, orderRows.map((o) => o.id))) : [];
  return {
    exportedAt: new Date().toISOString(),
    profile: { id: user.id, name: user.name, phone: user.phone, email: user.email, city: user.city, channel: user.channel, signedUpAt: new Date(user.createdAt).toISOString(), lastLoginAt: user.lastLoginAt ? new Date(user.lastLoginAt).toISOString() : undefined },
    consents: consents.map((c) => ({ purpose: c.purpose, action: c.action, wording: c.wording, source: c.source, at: c.createdAt })),
    deals: deals.map((d) => ({
      id: d.id,
      product: d.product.title,
      status: d.status,
      listPrice: d.originalPrice,
      dealPrice: d.dealPrice,
      createdAt: new Date(d.createdAt).toISOString(),
      store: d.shop?.storeName,
      conversation: d.negotiation?.messages.map((m) => ({ from: m.from, text: m.text })),
      deliveryAddress: d.checkout?.address,
    })),
    orders: orderRows.map((o) => ({ id: o.id, dealId: o.dealId, title: o.title, status: o.status, totalPaise: o.total, address: o.address, createdAt: o.createdAt, shippedAt: o.shippedAt, deliveredAt: o.deliveredAt })),
    disputes: disputeRows.map((d) => ({ id: d.id, orderId: d.orderId, reason: d.reason, details: d.details, status: d.status, resolution: d.resolution, createdAt: d.createdAt })),
    carts: cartRows.map((c) => ({ id: c.id, storeId: c.storeId, items: c.lines.map((l) => ({ title: l.title, quantity: l.quantity, unitPrice: l.unitPrice })), status: c.status, email: c.email, phone: c.phone, recoveryConsentAt: c.consentAt, createdAt: c.createdAt })),
    grievances: grievanceRows.map((g) => ({ id: g.id, category: g.category, message: g.message, status: g.status, response: g.response, createdAt: g.createdAt })),
  };
}

function scrubDeal(deal: Deal): Deal {
  const copy = structuredClone(deal);
  delete copy.userId;
  delete copy.city;
  if (copy.checkout?.address) {
    const { city, state, pincode } = copy.checkout.address;
    copy.checkout.address = { name: "Erased", phone: "", line1: "", city, state, pincode };
  }
  if (copy.negotiation) copy.negotiation.messages = copy.negotiation.messages.map((m) => (m.from === "shopper" ? { ...m, text: "[erased at the shopper's request]" } : m));
  return copy;
}

/**
 * Erase a shopper account (DPDP right to erasure). Names, phone, email, device links and the shopper's own
 * words go now. Orders stay for ORDER_RETENTION_YEARS, keeping only what the books need: amounts, dates,
 * and the city, state and pincode that decide GST place of supply.
 */
export async function deleteShopperAccount(user: User) {
  const db = await getDb();
  const mine = await db.select({ id: orders.id, status: orders.status, address: orders.address }).from(orders).where(eq(orders.userId, user.id));
  if (mine.some((o) => OPEN_ORDER.includes(o.status)))
    throw new PrivacyError("You have an order that isn't finished yet. You can delete your account once it's delivered and the return window has closed, or after it's cancelled.", 409);

  for (const o of mine) {
    const { city, state, pincode } = o.address;
    await db.update(orders).set({ address: { name: "Erased", city: city ?? "", state: state ?? "", pincode: pincode ?? "" }, updatedAt: new Date() }).where(eq(orders.id, o.id));
  }
  for (const deal of await dealsFor(user.id)) await store.saveDeal(scrubDeal(deal));

  await db.delete(deviceLinks).where(eq(deviceLinks.actorId, user.id));
  await eraseCartContact({ userId: user.id, phone: user.phone, email: user.email });
  await db.update(activity).set({ detail: "Erased at the shopper's request" }).where(eq(activity.userId, user.id));
  await recordConsent(user.id, "deal_contact", "withdrawn", "Account deleted", "account_deletion");
  await recordConsent(user.id, "recovery_offers", "withdrawn", "Account deleted", "account_deletion");

  const phone = user.phone;
  await store.updateUser({ id: user.id, name: "Deleted shopper", phone: `erased:${user.id}`, channel: user.channel, createdAt: user.createdAt });
  await store.releasePhone(phone);
  await store.log({ type: "signup", actor: "user", userId: user.id, detail: "A shopper deleted their account" });
  return { orders: mine.length };
}
