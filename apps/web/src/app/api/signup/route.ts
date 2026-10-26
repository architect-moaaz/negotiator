import { demographicsFrom } from "@/lib/demographics";
import { linkDevice } from "@/lib/fraud/signals";
import { OtpError, sendLoginCode, verifyLoginCode } from "@/lib/otp";
import { codeLimits, rateLimit, verifyLimits } from "@/lib/rate-limit";
import { issueSessionToken, startSession } from "@/lib/session";
import { store } from "@/lib/store";
import { maskPhone, normalizePhone, publicUser, signUp } from "@/lib/users";

/**
 * Shopper signup in two steps, so every account's number is proven:
 * 1. name + phone + consent → we call the number with a code ({ codeSent: true }).
 * 2. the same fields + code → account created (or the existing one for that number), session started.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    phone?: string;
    email?: string;
    consent?: boolean;
    referrer?: string;
    source?: string;
    code?: string;
    client?: string;
  };
  const name = body.name?.trim();
  const phone = body.phone ? normalizePhone(body.phone) : null;
  if (!name) return Response.json({ error: "Enter your name." }, { status: 400 });
  if (!phone) return Response.json({ error: "Enter a 10-digit Indian mobile number." }, { status: 400 });
  if (body.consent !== true) return Response.json({ error: "Tick the box to agree to be contacted about your deal." }, { status: 400 });
  if (body.email && !/^\S+@\S+\.\S+$/.test(body.email)) return Response.json({ error: "That email doesn't look right." }, { status: 400 });

  try {
    if (!body.code) {
      const limited = await rateLimit(...codeLimits(request, phone));
      if (limited) return limited;
      const { via } = await sendLoginCode("buyer-signup", phone);
      await store.log({ type: "login_code_sent", actor: "system", detail: `signup code via ${via} to ${maskPhone(phone)}` });
      return Response.json({ codeSent: true, via, phone: maskPhone(phone) });
    }
    const limited = await rateLimit(...verifyLimits(request));
    if (limited) return limited;
    await verifyLoginCode("buyer-signup", phone, body.code);
  } catch (err) {
    if (err instanceof OtpError) return Response.json({ error: err.message }, { status: err.status });
    console.error("signup code failed", err);
    return Response.json({ error: "Couldn't place the call. Try again in a moment." }, { status: 502 });
  }

  // The number is proven, so an existing account for it simply signs back in.
  const demographics = demographicsFrom(request, { referrer: body.referrer, source: body.source });
  const user = await signUp({ name, phone, email: body.email, channel: "web", city: demographics.city, consent: true, demographics, source: body.source?.slice(0, 40) });
  await linkDevice(request, "buyer", user.id);
  // The mobile app keeps the session token itself; browsers get a cookie.
  if (body.client === "mobile") return Response.json({ ...publicUser(user), token: await issueSessionToken("buyer", user.id) });
  await startSession("buyer", user.id);
  return Response.json(publicUser(user));
}
