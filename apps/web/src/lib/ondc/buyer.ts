import { schema } from "@ghostcart/db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
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

/** The newest of several callbacks (order updates arrive as on_status, on_cancel or on_update). */
async function latestOf(transactionId: string, actions: string[]) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(ondcMessages)
    .where(and(eq(ondcMessages.transactionId, transactionId), inArray(ondcMessages.action, actions), eq(ondcMessages.direction, "in")))
    .orderBy(desc(ondcMessages.id))
    .limit(1);
  return row?.payload as { context: Json; message?: Json; error?: { message?: string } } | undefined;
}

/** The order as the seller last described it (on_confirm, then status, cancellation or return updates). */
export async function orderState(transactionId: string) {
  const p = await latestOf(transactionId, ["on_confirm", "on_status", "on_cancel", "on_update"]);
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

// After the order: status, cancel, return, track, support, and IGM issues.

/** The confirmed order's seller app and id, or an error if there's no order yet. */
async function confirmedOrder(transactionId: string) {
  const p = await latest(transactionId, "on_confirm");
  const id = str((p?.message?.order as Json | undefined)?.id);
  if (!p || !id) throw new OndcError("There's no confirmed order for this yet.");
  return { bpp: { id: str(p.context.bpp_id), uri: str(p.context.bpp_uri) }, orderId: id, order: p.message!.order as Json };
}

/** ONDC retail cancellation reasons a buyer may give (the network's reason codes). */
export const CANCEL_REASONS = { "001": "Price of one or more items have changed", "003": "Product available at lower price", "006": "Order delayed", "009": "Wrong product delivered", "010": "Buyer doesn't want the product any more" } as const;

/** Ask the seller app for the order's latest state (answer on /on_status). */
export async function refreshStatus(transactionId: string, userId?: string) {
  const { bpp, orderId } = await confirmedOrder(transactionId);
  const ctx = context("status", transactionId, bpp);
  await send(bpp.uri, ctx, { order_id: orderId }, userId);
  return { messageId: ctx.message_id };
}

/** Cancel the whole order with one of the network's reason codes (answer on /on_cancel). */
export async function cancelOrder(transactionId: string, reason: string, userId?: string) {
  if (!(reason in CANCEL_REASONS)) throw new OndcError("Pick a reason for cancelling.");
  const { bpp, orderId } = await confirmedOrder(transactionId);
  const ctx = context("cancel", transactionId, bpp);
  await send(bpp.uri, ctx, { order_id: orderId, cancellation_reason_id: reason }, userId);
  return { messageId: ctx.message_id };
}

/** Ask to return a delivered item: an item-level update (the seller app answers on /on_update). */
export async function requestReturn(transactionId: string, reason: string, userId?: string) {
  const { bpp, orderId, order } = await confirmedOrder(transactionId);
  const item = ((order.items as Json[] | undefined) ?? [])[0];
  if (!item) throw new OndcError("This order has no items to return.");
  if (reason.trim().length < 5) throw new OndcError("Say why you're returning it.");
  const ctx = context("update", transactionId, bpp);
  await send(
    bpp.uri,
    ctx,
    {
      update_target: "item",
      order: {
        id: orderId,
        state: "Completed",
        provider: order.provider,
        items: [{ id: str(item.id), quantity: item.quantity ?? { count: 1 }, tags: { update_type: "return", reason_code: "001", ttl_approval: "PT24H", ttl_reverseqc: "P3D" } }],
        payment: order.payment,
      },
      reason: reason.trim().slice(0, 200),
    },
    userId,
  );
  return { messageId: ctx.message_id };
}

/** Where the parcel is (answer on /on_track: a tracking link from the seller app's logistics). */
export async function trackOrder(transactionId: string, userId?: string) {
  const { bpp, orderId } = await confirmedOrder(transactionId);
  const ctx = context("track", transactionId, bpp);
  await send(bpp.uri, ctx, { order_id: orderId }, userId);
  return { messageId: ctx.message_id };
}

export async function trackResult(transactionId: string) {
  const p = await latest(transactionId, "on_track");
  if (!p) return null;
  const t = (p.message?.tracking as Json | undefined) ?? {};
  return { url: str(t.url) || undefined, status: str(t.status) || undefined };
}

/** The seller's support contact (answer on /on_support). */
export async function askSupport(transactionId: string, userId?: string) {
  const { bpp, orderId } = await confirmedOrder(transactionId);
  const ctx = context("support", transactionId, bpp);
  await send(bpp.uri, ctx, { ref_id: orderId }, userId);
  return { messageId: ctx.message_id };
}

export async function supportResult(transactionId: string) {
  const p = await latest(transactionId, "on_support");
  if (!p) return null;
  const m = p.message ?? {};
  return { phone: str(m.phone) || undefined, email: str(m.email) || undefined, url: str(m.uri) || undefined };
}

/** IGM (ONDC's issue and grievance protocol, v1.0.0) categories a buyer can raise against an order. */
export const ISSUE_TYPES = { ITM01: "Missing items", ITM02: "Quantity issue", ITM03: "Item mismatch", ITM04: "Quality issue", FLM01: "Wrong delivery address", FLM02: "Delay in delivery", PMT01: "Refund not received" } as const;

/**
 * Raise an issue with the seller app under IGM. It answers on /on_issue with what it's doing, and
 * /issue_status asks for the latest; GhostCart (the buyer app) stays the shopper's point of contact.
 */
export async function raiseIssue(transactionId: string, input: { type: string; description: string; name: string; phone: string; email?: string }, userId?: string) {
  if (!(input.type in ISSUE_TYPES)) throw new OndcError("Pick what went wrong.");
  if (input.description.trim().length < 10) throw new OndcError("Describe the problem in a sentence or two.");
  const { bpp, orderId, order } = await confirmedOrder(transactionId);
  const c = ondcConfig();
  const now = new Date().toISOString();
  const issueId = randomUUID();
  const ctx = context("issue", transactionId, bpp, "1.0.0");
  await send(
    bpp.uri,
    ctx,
    {
      issue: {
        id: issueId,
        category: input.type.startsWith("ITM") ? "ITEM" : input.type.startsWith("FLM") ? "FULFILLMENT" : "PAYMENT",
        sub_category: input.type,
        complainant_info: { person: { name: input.name.slice(0, 80) }, contact: { phone: input.phone, ...(input.email && { email: input.email }) } },
        order_details: { id: orderId, state: "Completed", items: ((order.items as Json[] | undefined) ?? []).map((i) => ({ id: str(i.id), quantity: (i.quantity as Json | undefined)?.count ?? 1 })), provider_id: str((order.provider as Json | undefined)?.id) },
        description: { short_desc: ISSUE_TYPES[input.type as keyof typeof ISSUE_TYPES], long_desc: input.description.trim().slice(0, 1000) },
        source: { network_participant_id: c.subscriberId, type: "CONSUMER" },
        expected_response_time: { duration: "PT2H" },
        expected_resolution_time: { duration: "P1D" },
        status: "OPEN",
        issue_type: "ISSUE",
        issue_actions: { complainant_actions: [{ complainant_action: "OPEN", short_desc: "Complaint created", updated_at: now, updated_by: { org: { name: c.subscriberId }, contact: { phone: input.phone }, person: { name: input.name.slice(0, 80) } } }] },
        created_at: now,
        updated_at: now,
      },
    },
    userId,
  );
  return { issueId, messageId: ctx.message_id };
}

export async function issueStatusRequest(transactionId: string, issueId: string, userId?: string) {
  const { bpp } = await confirmedOrder(transactionId);
  const ctx = context("issue_status", transactionId, bpp, "1.0.0");
  await send(bpp.uri, ctx, { issue_id: issueId }, userId);
  return { messageId: ctx.message_id };
}

/** The seller app's latest word on an issue (on_issue or on_issue_status). */
export async function issueState(transactionId: string) {
  const p = await latestOf(transactionId, ["on_issue", "on_issue_status"]);
  if (!p) return null;
  const issue = (p.message?.issue as Json | undefined) ?? {};
  const action = (((issue.issue_actions as Json | undefined)?.respondent_actions as Json[] | undefined) ?? []).at(-1);
  const resolution = (issue.resolution as Json | undefined) ?? {};
  return { id: str(issue.id), status: str(issue.status) || undefined, lastAction: str(action?.respondent_action) || undefined, note: str(action?.short_desc) || undefined, resolution: str(resolution.short_desc) || undefined, refund: str(resolution.refund_amount) || undefined };
}
