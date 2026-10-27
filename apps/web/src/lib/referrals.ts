import { schema } from "@ghostcart/db";
import { count, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "./db";
import { store as kv } from "./store";

const { referralCodes, referrals } = schema;

/**
 * Invite links: every shopper has a code; a new shopper who signs up through it is recorded as theirs.
 * Attribution only. Rewards (GhostCart-funded credit or none) are a business decision still to make,
 * so nothing is promised to anyone in the product until then.
 */
export const REF_COOKIE = "gc_invite";
const CODE = /^[A-Z2-9]{8}$/;
const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export async function inviteCode(userId: string) {
  const db = await getDb();
  const [have] = await db.select().from(referralCodes).where(eq(referralCodes.userId, userId));
  if (have) return have.code;
  for (let i = 0; i < 5; i++) {
    const code = Array.from(randomBytes(8), (b) => alphabet[b % alphabet.length]).join("");
    const [row] = await db.insert(referralCodes).values({ code, userId }).onConflictDoNothing().returning();
    if (row) return row.code;
    const [mine] = await db.select().from(referralCodes).where(eq(referralCodes.userId, userId));
    if (mine) return mine.code; // a concurrent request made it
  }
  throw new Error("Couldn't make an invite code.");
}

/** A brand-new shopper signed up with an invite code (from the invite link's cookie). Once per shopper. */
export async function recordReferral(code: string | undefined, newUserId: string) {
  const clean = code?.trim().toUpperCase();
  if (!clean || !CODE.test(clean)) return null;
  const db = await getDb();
  const [owner] = await db.select().from(referralCodes).where(eq(referralCodes.code, clean));
  if (!owner || owner.userId === newUserId) return null;
  const [row] = await db.insert(referrals).values({ referredUserId: newUserId, referrerUserId: owner.userId, code: clean }).onConflictDoNothing().returning();
  if (row) await kv.log({ type: "signup", actor: "user", userId: newUserId, detail: `Joined through an invite from ${owner.userId}` });
  return row ?? null;
}

export async function referralCount(userId: string) {
  const db = await getDb();
  const [r] = await db.select({ n: count() }).from(referrals).where(eq(referrals.referrerUserId, userId));
  return r?.n ?? 0;
}
