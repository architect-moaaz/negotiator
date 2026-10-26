import { store } from "./store";

/** Client IP as Vercel reports it (first hop of x-forwarded-for). */
export function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

/**
 * Load tests on staging come from a few IPs and would trip every limit. RATE_LIMIT_ALLOWLIST (comma-separated
 * IPs) exempts them; it is ignored on Vercel production so a stray setting can't switch limits off.
 */
function allowlisted(id: string) {
  if (process.env.VERCEL_ENV === "production") return false;
  const list = process.env.RATE_LIMIT_ALLOWLIST;
  return !!list && list.split(",").some((ip) => ip.trim() === id);
}

export interface Limit {
  /** Bucket name, e.g. "code:phone". */
  name: string;
  /** What is being limited: a phone, an IP, a user id. */
  id: string;
  max: number;
  windowSeconds: number;
}

/**
 * Fixed-window rate limits. Returns a 429 response for the first limit exceeded, or null when the
 * request may proceed. Every listed limit counts the hit, so one noisy key can't hide behind another.
 */
export async function rateLimit(...limits: Limit[]): Promise<Response | null> {
  if (limits.some((l) => allowlisted(l.id))) return null;
  let blocked: { resetIn: number } | null = null;
  for (const l of limits) {
    try {
      const { count, resetIn } = await store.hit(`rl:${l.name}:${l.id}`, l.windowSeconds);
      if (count > l.max && (!blocked || resetIn > blocked.resetIn)) blocked = { resetIn };
    } catch (err) {
      console.error("rate limit check failed", err); // fail open: an outage shouldn't lock everyone out
    }
  }
  if (!blocked) return null;
  const wait = blocked.resetIn < 90 ? `${blocked.resetIn} seconds` : `${Math.ceil(blocked.resetIn / 60)} minutes`;
  return Response.json({ error: `Too many tries. Wait ${wait} and try again.` }, { status: 429, headers: { "Retry-After": String(blocked.resetIn) } });
}

/** Limits for anything that places an OTP call: per number and per IP. */
export const codeLimits = (request: Request, phone: string): Limit[] => [
  { name: "code:phone", id: phone, max: 5, windowSeconds: 60 * 60 },
  { name: "code:ip", id: clientIp(request), max: 20, windowSeconds: 60 * 60 },
];

/** Limits for checking a code (attempts per code are capped separately in otp.ts). */
export const verifyLimits = (request: Request): Limit[] => [{ name: "verify:ip", id: clientIp(request), max: 30, windowSeconds: 10 * 60 }];
