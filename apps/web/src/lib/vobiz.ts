import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.vobiz.ai/api/v1";
const AUTH_ID = process.env.VOBIZ_AUTH_ID;
const AUTH_TOKEN = process.env.VOBIZ_AUTH_TOKEN;
const FROM = process.env.VOBIZ_FROM_NUMBER;
export const VOICE_LANGUAGE = process.env.VOBIZ_LANGUAGE || "en-US";

export const vobizConfigured = Boolean(AUTH_ID && AUTH_TOKEN && FROM);

// Vobiz doesn't sign voice webhooks, so each callback URL carries an HMAC of the deal id.
function secret() {
  return process.env.VOBIZ_WEBHOOK_SECRET || process.env.ADMIN_TOKEN || "";
}

export function signDeal(dealId: string) {
  return createHmac("sha256", secret()).update(`voice:${dealId}`).digest("base64url").slice(0, 32);
}

export function verifyDealSignature(dealId: string | null, sig: string | null) {
  if (!dealId || !sig || !secret()) return false;
  const expected = Buffer.from(signDeal(dealId));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function voiceUrl(path: "answer" | "turn" | "hangup" | "otp", dealId: string) {
  return `${process.env.NEXT_PUBLIC_APP_URL}/api/voice/${path}?d=${encodeURIComponent(dealId)}&k=${signDeal(dealId)}`;
}

/** Place an outbound call; Vobiz fetches the answer URL for XML once the callee picks up. */
export async function placeCall({ to, dealId }: { to: string; dealId: string }) {
  const res = await fetch(`${API}/Account/${AUTH_ID}/Call/`, {
    method: "POST",
    headers: { "X-Auth-ID": AUTH_ID!, "X-Auth-Token": AUTH_TOKEN!, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM!.replace(/^\+/, ""),
      to,
      answer_url: voiceUrl("answer", dealId),
      answer_method: "POST",
      hangup_url: voiceUrl("hangup", dealId),
      hangup_method: "POST",
      caller_name: "GhostCart",
      time_limit: 180, // hangup_on_ring would also cut answered calls (it counts from first ring)
    }),
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Vobiz call failed ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as { request_uuid?: string; message?: string };
}

/** Call a phone and read out a login code (answer URL looks the code up by call id). */
export async function placeOtpCall({ to, callId }: { to: string; callId: string }) {
  const res = await fetch(`${API}/Account/${AUTH_ID}/Call/`, {
    method: "POST",
    headers: { "X-Auth-ID": AUTH_ID!, "X-Auth-Token": AUTH_TOKEN!, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM!.replace(/^\+/, ""),
      to,
      answer_url: voiceUrl("otp", callId),
      answer_method: "POST",
      caller_name: "GhostCart",
      time_limit: 60,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Vobiz OTP call failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Rupee amounts read naturally by English TTS: 18800 → "18,800 rupees". */
export const spokenInr = (n: number) => `${n.toLocaleString("en-IN")} rupees`;

export function xml(body: string) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<Response>${body}</Response>`, {
    headers: { "Content-Type": "application/xml" },
  });
}

export const speak = (text: string) => `<Speak language="${VOICE_LANGUAGE}">${esc(text)}</Speak>`;

/** Ask a question and collect either a spoken answer or a single keypress. */
export function gather(prompt: string, dealId: string) {
  return `<Gather action="${esc(voiceUrl("turn", dealId))}" method="POST" inputType="dtmf speech" numDigits="1" executionTimeout="10" speechEndTimeout="auto" speechModel="phone_call" language="${VOICE_LANGUAGE}" hints="approve,accept,yes,reject,no,decline,counter,offer,thousand,rupees">${speak(prompt)}</Gather>`;
}

export const hangup = () => "<Hangup/>";
