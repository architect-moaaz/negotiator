import twilio from "twilio";

const client =
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

export async function sendWhatsApp(to: string, body: string) {
  if (!client) return;
  await client.messages.create({ from: process.env.TWILIO_WHATSAPP_FROM, to, body });
}

export function validateTwilioRequest(signature: string | null, url: string, params: Record<string, string>) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return true; // local dev without Twilio
  return !!signature && twilio.validateRequest(token, signature, url, params);
}

/** Download inbound WhatsApp media (Twilio media URLs require account auth). */
export async function fetchTwilioMedia(url: string) {
  const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) throw new Error(`Twilio media fetch failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString("base64");
}
