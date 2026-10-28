import { schema } from "@ghostcart/db";
import { and, eq, gt, gte, isNull } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { getDb } from "./db";
import { sendEmail, simpleHtml } from "./email";
import { inr } from "./format";
import { recordConsent } from "./privacy/consent";
import { notifyBuyer } from "./push";
import { getProduct } from "./shop/products";
import { getStore } from "./shop/stores";
import { store as kv } from "./store";

const { priceAlerts } = schema;

/**
 * Price-drop alerts: a shopper asks to hear when a product's listed price reaches their target. Only the
 * public list price is compared, never the seller's private haggle limits, so an alert can't reveal how
 * low a seller would go. One message per alert, then it's done; a stop link in every message.
 */
export const ALERT_DAYS = 60;
export const PRICE_ALERT_WORDING = "Tell me once if this product's price drops to my target. I can stop it any time.";

export class AlertError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
export type PriceAlert = typeof priceAlerts.$inferSelect;

export async function setPriceAlert(userId: string, productId: string, target: number, now = new Date()) {
  const product = await getProduct(productId);
  if (!product || product.status !== "active") throw new AlertError("This product isn't available.", 404);
  const store = await getStore(product.storeId);
  if (!store || store.status !== "live") throw new AlertError("This shop isn't open.", 409);
  if (!Number.isInteger(target) || target < 1) throw new AlertError("Enter a price in whole rupees.");
  if (target >= product.price) throw new AlertError(`Pick a price below today's ${inr(product.price)}.`);
  if (target < Math.ceil(product.price * 0.1)) throw new AlertError("That's too low to be likely. Pick a price closer to today's.");
  const db = await getDb();
  await db
    .update(priceAlerts)
    .set({ stoppedAt: now })
    .where(and(eq(priceAlerts.userId, userId), eq(priceAlerts.productId, productId), isNull(priceAlerts.firedAt), isNull(priceAlerts.stoppedAt)));
  const token = randomBytes(18).toString("base64url");
  const [alert] = await db
    .insert(priceAlerts)
    .values({ id: `pal_${randomBytes(9).toString("base64url")}`, userId, productId, targetPrice: target, priceAtSet: product.price, stopTokenHash: hash(token), expiresAt: new Date(now.getTime() + ALERT_DAYS * 86_400_000) })
    .returning();
  await recordConsent(userId, "price_alerts", "granted", PRICE_ALERT_WORDING, `alert:${productId}`);
  await kv.log({ type: "price_alert_set", actor: "user", userId, detail: `Alert at ${inr(target)} on ${product.title} (now ${inr(product.price)})` });
  return { alert, stopToken: token };
}

export async function alertsForUser(userId: string, now = new Date()) {
  const db = await getDb();
  return db
    .select()
    .from(priceAlerts)
    .where(and(eq(priceAlerts.userId, userId), isNull(priceAlerts.firedAt), isNull(priceAlerts.stoppedAt), gt(priceAlerts.expiresAt, now)));
}

/** Stop from the link in a message (no sign-in) or from the account page (signed in, by id). */
export async function stopPriceAlert(by: { token: string } | { id: string; userId: string }, now = new Date()) {
  const db = await getDb();
  const where = "token" in by ? eq(priceAlerts.stopTokenHash, hash(by.token)) : and(eq(priceAlerts.id, by.id), eq(priceAlerts.userId, by.userId));
  const [row] = await db.update(priceAlerts).set({ stoppedAt: now }).where(and(where, isNull(priceAlerts.stoppedAt))).returning();
  if (row) await recordConsent(row.userId, "price_alerts", "withdrawn", "Stopped a price alert", "alert_stop");
  return row;
}

/**
 * A product's listed price changed: tell everyone whose target it now meets. Called after any price
 * update (seller edit, catalogue sync). Each alert fires once.
 */
export async function firePriceAlerts(productId: string, now = new Date()) {
  const product = await getProduct(productId);
  if (!product || product.status !== "active" || product.stock < 1) return 0;
  const db = await getDb();
  // Claim every live alert whose target the new price meets, so each fires once even if two updates race.
  const due = await db
    .update(priceAlerts)
    .set({ firedAt: now })
    .where(and(eq(priceAlerts.productId, productId), isNull(priceAlerts.firedAt), isNull(priceAlerts.stoppedAt), gt(priceAlerts.expiresAt, now), gte(priceAlerts.targetPrice, product.price)))
    .returning();
  const store = await getStore(product.storeId);
  const url = store ? `${appUrl()}/s/${store.slug}/${product.id}` : appUrl();
  let sent = 0;
  for (const a of due) {
    const body = `${product.title} is now ${inr(product.price)} at ${store?.name ?? "the shop"} (you asked at ${inr(a.targetPrice)}; it was ${inr(a.priceAtSet)}). You can still make an offer.`;
    let delivered = false;
    try {
      const user = await kv.getUser(a.userId);
      delivered = (await notifyBuyer(a.userId, { title: "Price dropped", body, data: { type: "product", productId: product.id } })) > 0;
      if (user?.email) {
        await sendEmail({
          to: user.email,
          subject: `Price dropped: ${product.title}`,
          text: `${body}\n\n${url}\n\nThis was a one-time alert you set. It's now off.`,
          html: simpleHtml([body], { label: "See it", url }, "This was a one-time alert you set on GhostCart. It's now off."),
        });
        delivered = true;
      }
    } catch (err) {
      console.warn(`price alert ${a.id} failed`, err);
    }
    if (!delivered) {
      // Nothing reached the shopper (no app, no email, or both failed): keep the alert live so it can
      // still fire on a later price change, and it stays on their account page.
      await db.update(priceAlerts).set({ firedAt: null }).where(eq(priceAlerts.id, a.id));
      continue;
    }
    sent++;
    await kv.log({ type: "price_alert_sent", actor: "system", userId: a.userId, detail: `${product.title} reached ${inr(product.price)} (target ${inr(a.targetPrice)})` });
  }
  return sent;
}
