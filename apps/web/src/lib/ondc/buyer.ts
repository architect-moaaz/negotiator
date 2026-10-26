import { schema } from "@ghostcart/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { context, OndcError, send } from "./client";
import { ondcConfig } from "./config";

const { ondcMessages } = schema;

/** Approximate city centres for the fulfillment GPS field (we deliver to a pincode; sellers need a point). */
const CITY_GPS: Record<string, string> = { "std:080": "12.9716,77.5946", "std:011": "28.6139,77.2090", "std:022": "19.0760,72.8777", "std:044": "13.0827,80.2707", "std:040": "17.3850,78.4867", "std:020": "18.5204,73.8567" };

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const inr = (v: unknown) => Math.round(Number(v) * 100) / 100;

async function messages(transactionId: string, action: string) {
  const db = await getDb();
  return db.select().from(ondcMessages).where(and(eq(ondcMessages.transactionId, transactionId), eq(ondcMessages.action, action), eq(ondcMessages.direction, "in"))).orderBy(asc(ondcMessages.createdAt));
}
async function latest(transactionId: string, action: string) {
  const db = await getDb();
  const [row] = await db.select().from(ondcMessages).where(and(eq(ondcMessages.transactionId, transactionId), eq(ondcMessages.action, action), eq(ondcMessages.direction, "in"))).orderBy(desc(ondcMessages.id)).limit(1);
  return row?.payload as { context: Json; message?: Json; error?: { message?: string } } | undefined;
}

/** Ask the network for an item by name. Sellers answer asynchronously on /on_search. */
export async function search(query: string, userId?: string) {
  const q = query.trim().slice(0, 80);
  if (q.length < 2) throw new OndcError("Type what you're looking for.");
  const transactionId = randomUUID();
  await send(ondcConfig().gatewayUrl, context("search", transactionId), { intent: { item: { descriptor: { name: q } }, fulfillment: { type: "Delivery" }, payment: { "@ondc/org/buyer_app_finder_fee_type": "percent", "@ondc/org/buyer_app_finder_fee_amount": "0" } } }, userId);
  return { transactionId };
}

export interface OndcItem {
  bppId: string;
  bppUri: string;
  sellerApp: string;
  providerId: string;
  providerName: string;
  locationId?: string;
  itemId: string;
  name: string;
  image?: string;
  price: number;
  mrp?: number;
  available?: number;
}

/** Everything sellers have answered so far for a search, flattened to items. */
export async function searchResults(transactionId: string): Promise<OndcItem[]> {
  const out: OndcItem[] = [];
  for (const row of await messages(transactionId, "on_search")) {
    const { context: ctx, message } = row.payload as { context: Json; message?: { catalog?: Json } };
    const catalog = message?.catalog ?? {};
    const sellerApp = str((catalog["bpp/descriptor"] as Json | undefined)?.name) || str(ctx.bpp_id);
    for (const p of (catalog["bpp/providers"] as Json[] | undefined) ?? []) {
      const providerName = str((p.descriptor as Json | undefined)?.name);
      for (const it of (p.items as Json[] | undefined) ?? []) {
        const d = (it.descriptor as Json | undefined) ?? {};
        const price = (it.price as Json | undefined) ?? {};
        const avail = ((it.quantity as Json | undefined)?.available as Json | undefined)?.count;
        out.push({
          bppId: str(ctx.bpp_id),
          bppUri: str(ctx.bpp_uri),
          sellerApp,
          providerId: str(p.id),
          providerName,
          locationId: str(it.location_id) || str(((p.locations as Json[] | undefined) ?? [])[0]?.id) || undefined,
          itemId: str(it.id),
          name: str(d.name),
          image: str(((d.images as unknown[] | undefined) ?? [])[0]) || undefined,
          price: inr(price.value),
          mrp: price.maximum_value ? inr(price.maximum_value) : undefined,
          available: avail === undefined ? undefined : Number(avail),
        });
      }
    }
  }
  return out.filter((i) => i.itemId && i.name && Number.isFinite(i.price));
}

export interface Pick {
  bppId: string;
  providerId: string;
  itemId: string;
  quantity: number;
  pincode: string;
}

async function chosen(transactionId: string, pick: Pick) {
  const item = (await searchResults(transactionId)).find((i) => i.bppId === pick.bppId && i.providerId === pick.providerId && i.itemId === pick.itemId);
  if (!item) throw new OndcError("That item isn't in this search any more. Search again.");
  if (!/^[1-9]\d{5}$/.test(pick.pincode)) throw new OndcError("A pincode is 6 digits.");
  if (!Number.isInteger(pick.quantity) || pick.quantity < 1 || pick.quantity > 10) throw new OndcError("Pick a quantity from 1 to 10.");
  return item;
}

/** Ask the seller for a quote (price, delivery charge, delivery time) for this item to this pincode. */
export async function select(transactionId: string, pick: Pick, userId?: string) {
  const item = await chosen(transactionId, pick);
  const c = ondcConfig();
  const ctx = context("select", transactionId, { id: item.bppId, uri: item.bppUri });
  await send(
    item.bppUri,
    ctx,
    {
      order: {
        provider: { id: item.providerId, ...(item.locationId && { locations: [{ id: item.locationId }] }) },
        items: [{ id: item.itemId, ...(item.locationId && { location_id: item.locationId }), quantity: { count: pick.quantity } }],
        fulfillments: [{ end: { location: { gps: CITY_GPS[c.city] ?? CITY_GPS["std:080"], address: { area_code: pick.pincode } } } }],
      },
    },
    userId,
  );
  return { messageId: ctx.message_id };
}

export interface Quote {
  total: number;
  currency: string;
  lines: { title: string; kind: string; amount: number }[];
  deliveryTime?: string;
  fulfillmentId?: string;
}

function readQuote(order: Json | undefined): Quote | null {
  const quote = order?.quote as Json | undefined;
  if (!quote) return null;
  const price = (quote.price as Json | undefined) ?? {};
  const fulfillment = ((order?.fulfillments as Json[] | undefined) ?? [])[0];
  return {
    total: inr(price.value),
    currency: str(price.currency) || "INR",
    lines: ((quote.breakup as Json[] | undefined) ?? []).map((b) => ({ title: str(b.title), kind: str(b["@ondc/org/title_type"]), amount: inr((b.price as Json | undefined)?.value) })),
    deliveryTime: str(fulfillment?.["@ondc/org/TAT"]) || undefined,
    fulfillmentId: str(fulfillment?.id) || undefined,
  };
}

/** The seller's answer to select: a quote, or the reason they can't serve it. Null while waiting. */
export async function selectResult(transactionId: string) {
  const p = await latest(transactionId, "on_select");
  if (!p) return null;
  if (p.error?.message) return { error: p.error.message };
  return { quote: readQuote(p.message?.order as Json | undefined) };
}

export interface Delivery {
  name: string;
  phone: string;
  email?: string;
  building: string;
  locality: string;
  city: string;
  state: string;
  pincode: string;
}

/** Send billing and delivery details; the seller answers on /on_init with the final quote and how to pay. */
export async function init(transactionId: string, pick: Pick, to: Delivery, userId?: string) {
  const item = await chosen(transactionId, pick);
  const fulfillmentId = (await selectResult(transactionId))?.quote?.fulfillmentId;
  if (!fulfillmentId) throw new OndcError("Get a quote first.");
  const c = ondcConfig();
  const now = new Date().toISOString();
  const address = { name: to.name, building: to.building, locality: to.locality, city: to.city, state: to.state, country: "IND", area_code: to.pincode };
  const ctx = context("init", transactionId, { id: item.bppId, uri: item.bppUri });
  await send(
    item.bppUri,
    ctx,
    {
      order: {
        provider: { id: item.providerId, ...(item.locationId && { locations: [{ id: item.locationId }] }) },
        items: [{ id: item.itemId, quantity: { count: pick.quantity }, fulfillment_id: fulfillmentId }],
        billing: { name: to.name, address, phone: to.phone, ...(to.email && { email: to.email }), created_at: now, updated_at: now },
        fulfillments: [{ id: fulfillmentId, type: "Delivery", end: { contact: { phone: to.phone, ...(to.email && { email: to.email }) }, location: { gps: CITY_GPS[c.city] ?? CITY_GPS["std:080"], address } } }],
      },
    },
    userId,
  );
  return { messageId: ctx.message_id };
}

/**
 * The seller's on_init: final quote and payment terms. GhostCart never collects ONDC payments itself
 * (it would need a settlement agreement with each seller app); only seller-collected payment is offered.
 */
export async function initResult(transactionId: string) {
  const p = await latest(transactionId, "on_init");
  if (!p) return null;
  if (p.error?.message) return { error: p.error.message };
  const order = p.message?.order as Json | undefined;
  const payment = (order?.payment as Json | undefined) ?? {};
  const collectedBy = str(payment.collected_by);
  return { quote: readQuote(order), payment: { collectedBy, uri: str(payment.uri) || undefined, type: str(payment.type) }, payable: collectedBy === "BPP" && !!payment.uri };
}

/** Place the order on the terms from on_init. Only for seller-collected payment (see initResult). */
export async function confirm(transactionId: string, userId?: string) {
  const p = await latest(transactionId, "on_init");
  const terms = await initResult(transactionId);
  if (!p || !terms || "error" in terms) throw new OndcError("Send your delivery details first.");
  if (!terms.payable) throw new OndcError("This seller only takes payment through the buyer app, which GhostCart doesn't offer on ONDC yet.");
  const order = p.message?.order as Json;
  const now = new Date().toISOString();
  const ctx = context("confirm", transactionId, { id: str(p.context.bpp_id), uri: str(p.context.bpp_uri) });
  await send(str(p.context.bpp_uri), ctx, { order: { ...order, id: `GC-${transactionId.slice(0, 8)}`, state: "Created", created_at: now, updated_at: now } }, userId);
  return { messageId: ctx.message_id };
}

/** The order as the seller last described it (on_confirm, then on_status updates). */
export async function orderState(transactionId: string) {
  const p = (await latest(transactionId, "on_status")) ?? (await latest(transactionId, "on_confirm"));
  if (!p) return null;
  if (p.error?.message) return { error: p.error.message };
  const order = (p.message?.order as Json | undefined) ?? {};
  const fulfillment = ((order.fulfillments as Json[] | undefined) ?? [])[0];
  return { id: str(order.id), state: str(order.state), fulfillmentState: str(((fulfillment?.state as Json | undefined)?.descriptor as Json | undefined)?.code) || undefined, quote: readQuote(order) };
}

/** Who started a transaction (null for an anonymous search), or undefined if we never started it. */
export async function transactionOwner(transactionId: string) {
  const db = await getDb();
  const [row] = await db
    .select({ userId: ondcMessages.userId })
    .from(ondcMessages)
    .where(and(eq(ondcMessages.transactionId, transactionId), eq(ondcMessages.direction, "out"), eq(ondcMessages.action, "search")))
    .limit(1);
  return row ? row.userId : undefined;
}
