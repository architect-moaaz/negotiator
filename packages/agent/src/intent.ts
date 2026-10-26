import { generateText, Output } from "ai";
import { z } from "zod";
import { model } from "./model";

/**
 * What a shopper means in a chat message. Rules first (fast, predictable); the model only for messages
 * the rules can't read, and even then it can only name an amount, which the code bounds-checks.
 */
export type Intent = { kind: "accept" } | { kind: "offer"; amount: number } | { kind: "stop" } | { kind: "pick"; index: number } | { kind: "unknown" };

const ACCEPT = /^(ok(ay)?|deal|done|yes|yeah|yep|accept(ed)?|agreed?|take it|i'?ll take it|sure|fine|haan|ha|theek hai|thik hai|chalega|pakka|confirm)\b/i;
const STOP = /^(stop|cancel|bye|no thanks|not interested|leave it|rehne do)\b/i;

/** "₹1,250", "rs 900", "900/-", "9k", "1.2k" → rupees; null if there's no usable number. */
export function parseAmount(text: string): number | null {
  const m = text.replace(/,/g, "").match(/(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(k|thousand)?(?:\s*\/-)?/i);
  if (!m) return null;
  const value = Number(m[1]) * (m[2] ? 1000 : 1);
  return Number.isFinite(value) && value >= 1 ? Math.round(value) : null;
}

export async function readIntent(text: string, context: { listPrice: number; currentOffer?: number; choosing?: number }): Promise<Intent> {
  const t = text.trim();
  if (!t) return { kind: "unknown" };
  if (STOP.test(t)) return { kind: "stop" };
  if (context.choosing && /^\d{1,2}$/.test(t)) {
    const index = Number(t) - 1;
    if (index >= 0 && index < context.choosing) return { kind: "pick", index };
  }
  if (ACCEPT.test(t) && !/\d/.test(t)) return { kind: "accept" };
  const amount = parseAmount(t);
  if (amount !== null && amount <= context.listPrice * 2) return { kind: "offer", amount };

  if (!process.env.ANTHROPIC_API_KEY) return { kind: "unknown" };
  try {
    const { output } = await generateText({
      model,
      maxOutputTokens: 80,
      output: Output.object({
        schema: z.object({ intent: z.enum(["accept", "offer", "stop", "unknown"]), amount: z.number().nullable() }),
      }),
      instructions:
        "Classify a shopper's chat message in a price negotiation. accept = agrees to the seller's current offer; offer = proposes a price (give it in rupees); stop = wants to end; unknown = anything else. Never invent an amount that isn't in the message.",
      prompt: JSON.stringify({ message: t.slice(0, 500), listPrice: context.listPrice, sellerOffer: context.currentOffer ?? null }),
    });
    if (output.intent === "offer" && output.amount && output.amount >= 1 && output.amount <= context.listPrice * 2 && t.includes(String(Math.round(output.amount)).slice(0, 2))) {
      return { kind: "offer", amount: Math.round(output.amount) };
    }
    if (output.intent === "accept" || output.intent === "stop") return { kind: output.intent };
  } catch (err) {
    console.warn("chat intent model failed", err);
  }
  return { kind: "unknown" };
}
