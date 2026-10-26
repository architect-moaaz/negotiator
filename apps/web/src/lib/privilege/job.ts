import { schema } from "@ghostcart/db";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { getStore } from "../shop/stores";
import { store as kv } from "../store";
import { cartsByStatus, expireStaleCarts, markAbandoned } from "./carts";
import { invitesForCarts } from "./invites";
import { reachableChannels, sendInvite, withinContactHours } from "./send";
import { getRecovery } from "./settings";

const { recoverySettings, stores } = schema;

/** At most this many invites per run, so one run stays well inside a function's time limit. */
const MAX_SENDS = 200;

/**
 * GhostCart Privilege, every 15 minutes: carts idle past the seller's delay become abandoned; abandoned
 * carts whose shopper consented get one private offer (09:00–21:00 IST, first channel that reaches them);
 * carts idle a week expire.
 */
export async function runRecovery(now = new Date()) {
  const db = await getDb();
  const live = await db
    .select({ id: stores.id })
    .from(recoverySettings)
    .innerJoin(stores, eq(stores.id, recoverySettings.storeId))
    .where(and(eq(recoverySettings.enabled, true), eq(stores.status, "live")));
  let abandoned = 0;
  let sent = 0;
  let failed = 0;
  const contactable = withinContactHours(now);
  for (const row of live) {
    const store = await getStore(row.id);
    if (!store) continue;
    const recovery = await getRecovery(store.id);
    const marked = await markAbandoned(store.id, recovery.delayMinutes, now);
    abandoned += marked.length;
    for (const c of marked) await kv.log({ type: "cart_abandoned", actor: "system", userId: c.userId ?? undefined, detail: `Cart ${c.id} at ${store.name} abandoned after ${recovery.delayMinutes} min` });
    if (!contactable || sent >= MAX_SENDS) continue;

    const waiting = (await cartsByStatus(store.id, ["abandoned"])).filter((c) => c.consentAt && (c.email || c.phone));
    // One private offer per cart: anything already sent (or tried) on a channel counts.
    const tried = new Set((await invitesForCarts(waiting.map((c) => c.id))).filter((i) => i.channel !== "link").map((i) => i.cartId));
    for (const cart of waiting) {
      if (tried.has(cart.id) || sent >= MAX_SENDS) continue;
      const [channel] = await reachableChannels(cart, store, recovery);
      if (!channel) continue;
      try {
        await sendInvite(cart, store, channel, now);
        sent++;
      } catch {
        failed++; // recorded on the invite; not retried, so a bad address isn't contacted again and again
      }
    }
  }
  const expired = (await expireStaleCarts(now)).length;
  return { stores: live.length, abandoned, sent, failed, expired, contactable };
}
