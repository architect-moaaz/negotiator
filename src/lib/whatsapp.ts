import twilio from "twilio";

const client =
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

export async function sendWhatsApp(to: string, body: string) {
  if (!client) return;
  await client.messages.create({ from: process.env.TWILIO_WHATSAPP_FROM, to, body });
}
