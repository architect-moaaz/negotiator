import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { store } from "./store";

/**
 * Server-side sessions: the cookie holds a random token, Redis maps its hash to the account.
 * Nothing in the cookie identifies the account, and deleting the key revokes it immediately.
 */
export type SessionKind = "buyer" | "seller" | "staff" | "member";

/** member: a person acting for one or more seller businesses (orgs), identified by verified phone. */
const COOKIE: Record<SessionKind, string> = { buyer: "gc_session", seller: "gc_sid", staff: "gc_staff", member: "gc_member" };
const TTL_S: Record<SessionKind, number> = { buyer: 30 * 24 * 60 * 60, seller: 7 * 24 * 60 * 60, staff: 12 * 60 * 60, member: 7 * 24 * 60 * 60 };
/** Pre-hardening buyer cookie that held the raw user id. Ignored and cleared. */
export const LEGACY_BUYER_COOKIE = "gc_uid";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const key = (kind: SessionKind, token: string) => `session:${kind}:${hash(token)}`;

export const sessionCookieName = (kind: SessionKind) => COOKIE[kind];

/** A live session token for this account, without a cookie (load-test seeding; startSession uses it). */
export async function issueSessionToken(kind: SessionKind, subject: string) {
  const token = randomBytes(32).toString("base64url");
  await store.kvSet(key(kind, token), subject, TTL_S[kind]);
  return token;
}

/** Create a session and set its cookie. */
export async function startSession(kind: SessionKind, subject: string) {
  const token = await issueSessionToken(kind, subject);
  const jar = await cookies();
  jar.set(COOKIE[kind], token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: TTL_S[kind],
    path: "/",
  });
  if (kind === "buyer") jar.delete(LEGACY_BUYER_COOKIE);
}

/** The account id behind a session token, if the session is live. */
export async function sessionSubject(kind: SessionKind, token: string | undefined) {
  if (!token) return undefined;
  return (await store.kvGet<string>(key(kind, token))) ?? undefined;
}

/** Account id for the current request's session cookie (server components and route handlers). */
export async function currentSubject(kind: SessionKind) {
  return sessionSubject(kind, (await cookies()).get(COOKIE[kind])?.value);
}

/** Revoke the current session and clear its cookie. */
export async function endSession(kind: SessionKind) {
  const jar = await cookies();
  const token = jar.get(COOKIE[kind])?.value;
  if (token) await store.kvDel(key(kind, token));
  jar.delete(COOKIE[kind]);
  if (kind === "buyer") jar.delete(LEGACY_BUYER_COOKIE);
}

/** Session token from a raw Cookie header (for code paths that only have the Request). */
export function sessionTokenFromRequest(kind: SessionKind, request: Request) {
  const raw = request.headers.get("cookie")?.match(new RegExp(`(?:^|; )${COOKIE[kind]}=([^;]+)`))?.[1];
  return raw ? decodeURIComponent(raw) : undefined;
}
