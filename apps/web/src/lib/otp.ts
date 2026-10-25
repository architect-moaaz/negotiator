import { createHash, randomInt } from "node:crypto";
import { store } from "./store";
import { placeOtpCall, vobizConfigured } from "./vobiz";

const CODE_TTL_S = 5 * 60;
const RESEND_S = 40;
const MAX_ATTEMPTS = 5;

export type LoginRole = "buyer" | "seller" | "staff" | "member";
/** What a code proves: logging in to an account, or owning a number before an account exists. */
export type OtpPurpose = LoginRole | "buyer-signup" | "seller-signup";

interface OtpRecord {
  hash: string;
  attempts: number;
  expiresAt: number;
}

const hash = (phone: string, code: string) => createHash("sha256").update(`${phone}:${code}`).digest("hex");
const key = (role: OtpPurpose, phone: string) => `otp:${role}:${phone}`;

export class OtpError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** Create a 6-digit login code and read it out to the phone via a Vobiz voice call. */
export async function sendLoginCode(role: OtpPurpose, phone: string) {
  if (!(await store.claimOnce(`otp-throttle:${phone}`, RESEND_S))) throw new OtpError("We just called you. Wait a few seconds before asking for another code.", 429);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await store.kvSet<OtpRecord>(key(role, phone), { hash: hash(phone, code), attempts: 0, expiresAt: Date.now() + CODE_TTL_S * 1000 }, CODE_TTL_S);

  if (!vobizConfigured) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[dev] login code for ${phone}: ${code}`);
      return { via: "dev-console" as const };
    }
    throw new OtpError("Login by phone isn't available right now.", 503);
  }
  const callId = crypto.randomUUID();
  await store.kvSet(`otpcall:${callId}`, code, CODE_TTL_S);
  await placeOtpCall({ to: phone, callId });
  return { via: "call" as const };
}

export async function verifyLoginCode(role: OtpPurpose, phone: string, code: string) {
  const rec = await store.kvGet<OtpRecord>(key(role, phone));
  if (!rec || rec.expiresAt < Date.now()) throw new OtpError("That code has expired. Ask for a new one.");
  if (rec.attempts >= MAX_ATTEMPTS) throw new OtpError("Too many wrong codes. Ask for a new one.", 429);
  if (rec.hash !== hash(phone, code.replace(/\D/g, ""))) {
    rec.attempts += 1;
    await store.kvSet(key(role, phone), rec, Math.max(1, Math.round((rec.expiresAt - Date.now()) / 1000)));
    throw new OtpError("That code isn't right. Check the number we read out.");
  }
  await store.kvDel(key(role, phone));
}

/** Digits spaced out for text-to-speech: "4, 8, 2, 9, 1, 6". */
export const spokenCode = (code: string) => code.split("").join(", ");
