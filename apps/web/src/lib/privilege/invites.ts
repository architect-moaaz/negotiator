import { createHash, randomBytes } from "node:crypto";
import { schema } from "@ghostcart/db";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { newId } from "../shop/ids";
import { getStore } from "../shop/stores";
import { store as kv } from "../store";
import { getCart, RECOVERABLE, type CartRow, type CartStatus } from "./carts";

const { cartInvites } = schema;

export type InviteChannel = "link" | "email" | "whatsapp" | "voice";
export type InviteRow = typeof cartInvites.$inferSelect;

/** How long a private invite works. Stated plainly on the page and in every message. */
export const INVITE_HOURS = 48;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** A new private link for a cart. The token is returned once; only its hash is stored. */
export async function createInvite(cartId: string, channel: InviteChannel, now = new Date()) {
  const token = randomBytes(24).toString("base64url");
  const db = await getDb();
  const [invite] = await db
    .insert(cartInvites)
    .values({ id: newId("inv"), cartId, channel, tokenHash: hash(token), expiresAt: new Date(now.getTime() + INVITE_HOURS * 60 * 60 * 1000) })
    .returning();
  return { invite, token, url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/p/${token}` };
}

export async function setInviteStatus(id: string, status: "sent" | "opened" | "used" | "failed" | "expired", error?: string) {
  const db = await getDb();
  const now = new Date();
  await db
    .update(cartInvites)
    .set({ status, error: error ?? null, ...(status === "sent" ? { sentAt: now } : status === "opened" ? { openedAt: now } : {}) })
    .where(eq(cartInvites.id, id));
}

export async function getInvite(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(cartInvites).where(eq(cartInvites.id, id));
  return row;
}

export async function invitesForCart(cartId: string) {
  const db = await getDb();
  return db.select().from(cartInvites).where(eq(cartInvites.cartId, cartId));
}

export async function invitesForCarts(cartIds: string[]) {
  if (!cartIds.length) return [];
  const db = await getDb();
  return db.select().from(cartInvites).where(inArray(cartInvites.cartId, cartIds));
}

export interface ResolvedInvite {
  invite: InviteRow;
  cart: CartRow;
  store: NonNullable<Awaited<ReturnType<typeof getStore>>>;
  /** Why it can't be used now (expired, already bought, stopped), or undefined when it's live. */
  closed?: string;
}

/** Look up a private link. Opening it is recorded. */
export async function resolveInvite(token: string, now = Date.now()): Promise<ResolvedInvite | undefined> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return undefined;
  const db = await getDb();
  const [invite] = await db.select().from(cartInvites).where(eq(cartInvites.tokenHash, hash(token)));
  if (!invite) return undefined;
  const cart = await getCart(invite.cartId);
  const store = cart && (await getStore(cart.storeId));
  if (!cart || !store) return undefined;
  let closed: string | undefined;
  if (cart.status === "opted_out") closed = "You've stopped offers for this cart.";
  else if (cart.status === "recovered" || cart.status === "completed") closed = "This cart has already been checked out.";
  else if (invite.expiresAt.getTime() < now || cart.status === "expired") closed = "This private offer has expired.";
  else if (store.status !== "live") closed = `${store.name} isn't taking orders on GhostCart right now.`;
  else if (!RECOVERABLE.includes(cart.status as CartStatus) && cart.status !== "negotiating") closed = "This private offer isn't available.";
  if (!closed && !invite.openedAt) {
    await setInviteStatus(invite.id, "opened");
    await kv.log({ type: "privilege_opened", actor: "user", userId: cart.userId ?? undefined, detail: `Private offer opened (${invite.channel}) for cart ${cart.id}, ${store.name}` });
  }
  return { invite, cart, store, closed };
}

/** Invites still waiting for the shopper on any of these carts (so we don't send another). */
export async function hasLiveInvite(cartId: string, now = Date.now()) {
  const db = await getDb();
  const rows = await db.select().from(cartInvites).where(and(eq(cartInvites.cartId, cartId), inArray(cartInvites.status, ["created", "sent", "opened"])));
  return rows.some((r) => r.expiresAt.getTime() > now);
}
