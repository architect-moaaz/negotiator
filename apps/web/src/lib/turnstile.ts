import { clientIp } from "./rate-limit";

/**
 * Cloudflare Turnstile in front of everything that places a paid phone call (login and signup codes),
 * so bots can't make us ring numbers. Off until TURNSTILE_SECRET_KEY is set; Cloudflare's published test
 * keys work in development. The mobile app can't show the widget, so app requests rely on the rate
 * limits until device attestation (App Attest / Play Integrity) is added.
 */
export const turnstileEnabled = () => !!process.env.TURNSTILE_SECRET_KEY;

export async function verifyTurnstile(token: unknown, request: Request): Promise<boolean> {
  if (!turnstileEnabled()) return true;
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  try {
    const res = await fetch(process.env.TURNSTILE_VERIFY_URL ?? "https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY!, response: token, remoteip: clientIp(request) }),
      signal: AbortSignal.timeout(5000),
    });
    const out = (await res.json()) as { success?: boolean };
    return out.success === true;
  } catch (err) {
    // Cloudflare unreachable: fail closed (the rate limits still apply to retries).
    console.error("turnstile verify failed", err);
    return false;
  }
}

/** Shared 403 for a missing or failed check. */
export const turnstileFailed = () => Response.json({ error: "Please complete the check above the button, then try again.", turnstile: true }, { status: 403 });
