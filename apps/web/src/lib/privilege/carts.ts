import { schema } from "@ghostcart/db";
import { and, eq, inArray, lt, or } from "drizzle-orm";
import { getDb } from "../db";
import { recordConsent, RECOVERY_OFFER_WORDING } from "../privacy/consent";
import { newId } from "../shop/ids";
import { getProductByRef } from "../shop/products";
import { store as kv } from "../store";
import { normalizePhone } from "../users";

const { carts } = schema;

export type CartRow = typeof carts.$inferSelect;
export type CartStatus = "open" | "abandoned" | "invited" | "negotiating" | "recovered" | "completed" | "expired" | "opted_out";
export type CartSource = "widget" | "shopify_checkout" | "woo_checkout" | "ghostcart_checkout" | "rescue";
export type CartLine = CartRow["lines"][number];

/** Statuses where the cart is still worth a private offer. */
export const RECOVERABLE: CartStatus[] = ["open", "abandoned", "invited"];

export class CartError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export interface CaptureInput {
  storeId: string;
  source: CartSource;
  /** The platform's own id, so repeat reports update one cart. */
  externalRef?: string;
  /** Items as the platform names them: GhostCart product id, or the synced SKU ("shopify-123", "woo-45"). */
  items: { ref: string; quantity: number }[];
  userId?: string;
  contact?: { email?: string; phone?: string; name?: string };
  /** The shopper ticked the recovery-offer box (checkout) or asked for an offer themselves. */
  consent?: boolean;
  /** What the shopper agreed to, when it wasn't GhostCart's own wording (recorded with the consent). */
  consentWording?: string;
  returnUrl?: string;
}

const MAX_LINES = 20;

/** Indian mobiles to E.164, plausible emails lower-cased; anything else is dropped rather than stored. */
function cleanContact(c: CaptureInput["contact"]) {
  if (!c) return undefined;
  const email = c.email?.trim().toLowerCase();
  return {
    email: email && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined,
    phone: (c.phone && normalizePhone(c.phone)) || undefined,
    name: c.name?.trim().slice(0, 80) || undefined,
  };
}

/**
 * Record (or refresh) a cart. Prices always come from the synced catalogue, never from the page: a
 * cart line only exists for a product GhostCart knows in this store. Unknown items are dropped.
 */
export async function captureCart(input: CaptureInput): Promise<CartRow> {
  const lines: CartLine[] = [];
  for (const item of input.items.slice(0, MAX_LINES)) {
    const qty = Math.min(10, Math.max(1, Math.floor(item.quantity || 1)));
    const p = item.ref && (await getProductByRef(input.storeId, item.ref));
    if (!p || p.status !== "active") continue;
    const existing = lines.find((l) => l.productId === p.id);
    if (existing) existing.quantity = Math.min(10, existing.quantity + qty);
    else lines.push({ productId: p.id, quantity: qty, unitPrice: p.price, title: p.title, image: p.images[0] });
  }
  if (!lines.length) throw new CartError("None of these items are on GhostCart for this store.", 404);
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const now = new Date();
  const contact = input.consent ? cleanContact(input.contact) : undefined; // keep contact details only with consent
  const db = await getDb();

  const existing = input.externalRef
    ? (await db.select().from(carts).where(and(eq(carts.storeId, input.storeId), eq(carts.source, input.source), eq(carts.externalRef, input.externalRef))))[0]
    : undefined;
  let row: CartRow;
  if (existing) {
    if (!RECOVERABLE.includes(existing.status as CartStatus)) return existing; // finished carts don't reopen
    [row] = await db
      .update(carts)
      .set({
        lines,
        subtotal,
        userId: input.userId ?? existing.userId,
        email: contact?.email ?? existing.email,
        phone: contact?.phone ?? existing.phone,
        name: contact?.name ?? existing.name,
        consentAt: input.consent ? (existing.consentAt ?? now) : existing.consentAt,
        returnUrl: input.returnUrl ?? existing.returnUrl,
        status: "open",
        lastActivityAt: now,
      })
      .where(eq(carts.id, existing.id))
      .returning();
  } else {
    [row] = await db
      .insert(carts)
      .values({
        id: newId("cart"),
        storeId: input.storeId,
        source: input.source,
        externalRef: input.externalRef ?? null,
        lines,
        subtotal,
        userId: input.userId ?? null,
        email: contact?.email ?? null,
        phone: contact?.phone ?? null,
        name: contact?.name ?? null,
        consentAt: input.consent ? now : null,
        returnUrl: input.returnUrl ?? null,
        lastActivityAt: now,
      })
      .returning();
  }
  if (input.consent && !existing?.consentAt) {
    await recordConsent(input.userId ?? contact?.phone ?? contact?.email ?? row.id, "recovery_offers", "granted", input.consentWording ?? RECOVERY_OFFER_WORDING, `cart:${input.source}`);
  }
  await kv.log({ type: "cart_captured", actor: "system", userId: input.userId, detail: `${input.source} cart ${row.id}: ${lines.length} item(s), list ₹${subtotal}${input.consent ? ", recovery consent" : ""}` });
  return row;
}

export async function getCart(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(carts).where(eq(carts.id, id));
  return row;
}

export async function updateCart(id: string, patch: Partial<Omit<CartRow, "id" | "storeId">>) {
  const db = await getDb();
  const [row] = await db.update(carts).set(patch).where(eq(carts.id, id)).returning();
  return row;
}

/** The shopper finished checking out on their own: no offer needed. */
export async function completeCart(storeId: string, source: CartSource, externalRef: string) {
  const db = await getDb();
  await db
    .update(carts)
    .set({ status: "completed" })
    .where(and(eq(carts.storeId, storeId), eq(carts.source, source), eq(carts.externalRef, externalRef), inArray(carts.status, RECOVERABLE)));
}

/** Open carts idle past the store's delay become abandoned (eligible for an invite). */
export async function markAbandoned(storeId: string, delayMinutes: number, now = new Date()) {
  const db = await getDb();
  const cutoff = new Date(now.getTime() - delayMinutes * 60 * 1000);
  return db
    .update(carts)
    .set({ status: "abandoned", abandonedAt: now })
    .where(and(eq(carts.storeId, storeId), eq(carts.status, "open"), lt(carts.lastActivityAt, cutoff)))
    .returning();
}

/** Carts nobody acted on within a week stop being offered. */
export async function expireStaleCarts(now = new Date()) {
  const db = await getDb();
  const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return db.update(carts).set({ status: "expired" }).where(and(inArray(carts.status, RECOVERABLE), lt(carts.lastActivityAt, cutoff))).returning({ id: carts.id });
}

export async function cartsByStatus(storeId: string, statuses: CartStatus[]) {
  const db = await getDb();
  return db.select().from(carts).where(and(eq(carts.storeId, storeId), inArray(carts.status, statuses)));
}

export async function cartsForStore(storeId: string) {
  const db = await getDb();
  return db.select().from(carts).where(eq(carts.storeId, storeId));
}

type Who = { userId?: string; email?: string; phone?: string };

function whoMatches(who: Who) {
  const email = who.email?.trim().toLowerCase();
  const phone = who.phone ? normalizePhone(who.phone) : null;
  return [who.userId ? eq(carts.userId, who.userId) : undefined, email ? eq(carts.email, email) : undefined, phone ? eq(carts.phone, phone) : undefined].filter(
    (c) => c !== undefined,
  );
}

/**
 * Forget a shopper's contact details on carts (account deletion, or Shopify's customers/redact for one
 * store). The cart's items stay for the seller's stats, no longer tied to anyone. Returns how many.
 */
export async function eraseCartContact(who: Who, storeId?: string) {
  const match = whoMatches(who);
  if (!match.length) return 0;
  const db = await getDb();
  const rows = await db
    .update(carts)
    .set({ email: null, phone: null, name: null, userId: null })
    .where(and(or(...match), storeId ? eq(carts.storeId, storeId) : undefined))
    .returning({ id: carts.id });
  return rows.length;
}

/** Carts tied to a shopper (data export, or Shopify's customers/data_request for one store). */
export async function cartsWithContact(who: Who, storeId?: string) {
  const match = whoMatches(who);
  if (!match.length) return [];
  const db = await getDb();
  return db.select().from(carts).where(and(or(...match), storeId ? eq(carts.storeId, storeId) : undefined));
}
