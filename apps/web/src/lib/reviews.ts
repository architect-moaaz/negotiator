import { schema } from "@ghostcart/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "./db";
import { getOrder, OrderError, type Order } from "./orders/service";
import { store as kv } from "./store";

const { productReviews } = schema;
export type Review = typeof productReviews.$inferSelect;

/**
 * Reviews from verified buyers only: the buyer of a delivered order, once per order. Ratings can't be
 * edited by anyone; sellers reply once; staff can hide (not alter) abusive ones. Nothing is offered in
 * exchange for a review (Consumer Protection (E-Commerce) Rules; no fake or incentivised reviews).
 */
const REVIEWABLE = ["delivered", "completed"];
const LINK = /https?:\/\/|www\./i;

/** "Asha Kumar" → "Asha K." */
export const shortName = (name: string) => {
  const [first, ...rest] = name.trim().split(/\s+/);
  return rest.length ? `${first} ${rest.at(-1)![0].toUpperCase()}.` : first || "Buyer";
};

export async function reviewForOrder(orderId: string) {
  const db = await getDb();
  const [r] = await db.select().from(productReviews).where(eq(productReviews.orderId, orderId));
  return r;
}

export async function canReview(order: Order) {
  return REVIEWABLE.includes(order.status) && !(await reviewForOrder(order.id));
}

export async function addReview(orderId: string, userId: string, input: { rating: number; body?: string }) {
  const order = await getOrder(orderId);
  if (!order || order.userId !== userId) throw new OrderError("Order not found.", 404);
  if (!REVIEWABLE.includes(order.status)) throw new OrderError("You can review once your order is delivered.", 409);
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new OrderError("Pick 1 to 5 stars.");
  const body = (input.body ?? "").trim().slice(0, 1000);
  if (LINK.test(body)) throw new OrderError("Leave links out of reviews.");
  const user = await kv.getUser(userId);
  const db = await getDb();
  const [r] = await db
    .insert(productReviews)
    .values({ id: `rev_${randomBytes(9).toString("base64url")}`, orderId, storeId: order.storeId, productId: order.productId, userId, authorName: shortName(user?.name ?? "Buyer"), rating: input.rating, body })
    .onConflictDoNothing({ target: productReviews.orderId })
    .returning();
  if (!r) throw new OrderError("You've already reviewed this order.", 409);
  return r;
}

export async function replyToReview(storeId: string, reviewId: string, reply: string) {
  const text = reply.trim().slice(0, 1000);
  if (text.length < 2) throw new OrderError("Write your reply.");
  if (LINK.test(text)) throw new OrderError("Leave links out of replies.");
  const db = await getDb();
  const [r] = await db
    .update(productReviews)
    .set({ sellerReply: text, sellerRepliedAt: new Date() })
    .where(and(eq(productReviews.id, reviewId), eq(productReviews.storeId, storeId), isNull(productReviews.sellerReply)))
    .returning();
  if (!r) throw new OrderError("That review isn't yours to answer, or you've replied already.", 409);
  return r;
}

/** Staff only: hide or show a review. The rating and words are never changed. */
export async function setReviewHidden(reviewId: string, hidden: boolean, reason: string, by: string) {
  if (hidden && reason.trim().length < 5) throw new OrderError("Say why it's hidden.");
  const db = await getDb();
  const [r] = await db
    .update(productReviews)
    .set(hidden ? { hiddenAt: new Date(), hiddenReason: reason.trim().slice(0, 300) } : { hiddenAt: null, hiddenReason: null })
    .where(eq(productReviews.id, reviewId))
    .returning();
  if (r) await kv.log({ type: "staff_action", actor: "human", detail: `${by} ${hidden ? "hid" : "restored"} review ${reviewId}${hidden ? `: ${reason}` : ""}` });
  return r;
}

/** Visible reviews and the average, for a product or a whole store. */
export async function reviewSummary(by: { productId: string } | { storeId: string }, limit = 5) {
  const db = await getDb();
  const where = and("productId" in by ? eq(productReviews.productId, by.productId) : eq(productReviews.storeId, by.storeId), isNull(productReviews.hiddenAt));
  const [agg] = await db.select({ count: sql<number>`count(*)::int`, average: sql<number>`coalesce(avg(${productReviews.rating}), 0)::float` }).from(productReviews).where(where);
  const latest = await db.select().from(productReviews).where(where).orderBy(desc(productReviews.createdAt)).limit(limit);
  return { count: agg?.count ?? 0, average: Math.round((agg?.average ?? 0) * 10) / 10, latest };
}

export async function reviewsForStore(storeId: string) {
  const db = await getDb();
  return db.select().from(productReviews).where(eq(productReviews.storeId, storeId)).orderBy(desc(productReviews.createdAt)).limit(200);
}
