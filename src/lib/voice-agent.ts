import { anthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { Deal } from "./types";
import { spokenInr } from "./vobiz";

const fastModel = anthropic(process.env.GHOSTCART_VOICE_MODEL ?? "claude-haiku-5-5");

export type ApproverIntent =
  | { intent: "approve" }
  | { intent: "reject" }
  | { intent: "counter"; price: number }
  | { intent: "confirm" } // yes to a pending counter
  | { intent: "unclear" };

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** "19,000", "19000", "19k", "nineteen thousand five hundred" → number. */
export function parseSpokenPrice(text: string): number | undefined {
  const t = text.toLowerCase().replace(/₹|rs\.?|rupees?|inr/g, " ");
  const k = t.match(/(\d+(?:\.\d+)?)\s*k\b/);
  if (k) return Math.round(Number(k[1]) * 1000);
  const digits = t.match(/\d[\d,]*(?:\.\d+)?/g)?.map((d) => Number(d.replace(/,/g, ""))).filter((n) => n >= 10);
  if (digits?.length) {
    // "19 thousand 500"
    const thousand = t.match(/(\d+)\s*thousand(?:\s*(?:and\s*)?(\d+))?/);
    if (thousand) return Number(thousand[1]) * 1000 + Number(thousand[2] ?? 0);
    return Math.max(...digits);
  }
  let total = 0;
  let current = 0;
  let seen = false;
  for (const w of t.split(/[\s-]+/)) {
    if (w in WORD_NUMBERS) {
      current += WORD_NUMBERS[w];
      seen = true;
    } else if (w === "hundred") current *= 100;
    else if (w === "thousand") {
      total += current * 1000;
      current = 0;
    } else if (w === "lakh") {
      total += current * 100000;
      current = 0;
    }
  }
  return seen ? total + current : undefined;
}

/** Keyword fallback when no LLM is available (or it times out). */
export function interpretByKeywords(text: string, hasPendingCounter: boolean): ApproverIntent {
  const t = ` ${text.toLowerCase()} `;
  const yes = /\b(yes|yeah|yep|approve|approved|accept|ok|okay|done|sure|go ahead|confirm|haan|ha|theek|thik|chalega)\b/.test(t);
  const no = /\b(no|nope|reject|decline|don't|dont|nahi|nahin|na)\b/.test(t);
  const price = parseSpokenPrice(text);
  if (price && price >= 10) return { intent: "counter", price };
  if (hasPendingCounter && yes && !no) return { intent: "confirm" };
  if (no && !yes) return { intent: "reject" };
  if (yes && !no) return { intent: "approve" };
  return { intent: "unclear" };
}

/** Understand what the approver said on the call. Digits are unambiguous; speech goes to a fast model. */
export async function interpretApprover(
  input: { digits?: string; speech?: string },
  ctx: { shopperOffer: number; listPrice: number; pendingCounter?: number },
): Promise<ApproverIntent> {
  if (input.digits === "1") return ctx.pendingCounter ? { intent: "confirm" } : { intent: "approve" };
  if (input.digits === "2") return { intent: "reject" };
  const speech = input.speech?.trim();
  if (!speech) return { intent: "unclear" };
  const fallback = interpretByKeywords(speech, !!ctx.pendingCounter);
  if (!process.env.ANTHROPIC_API_KEY) return fallback;

  try {
    const { output } = await generateText({
      model: fastModel,
      maxOutputTokens: 120,
      abortSignal: AbortSignal.timeout(2500),
      output: Output.object({
        schema: z.object({
          intent: z.enum(["approve", "reject", "counter", "confirm", "unclear"]),
          price: z.number().optional().describe("Rupee amount for a counter-offer"),
        }),
      }),
      instructions: `You interpret a merchant's spoken reply on a phone call (Indian English or Hinglish, speech-to-text, may be messy).
They were asked whether to accept a shopper's offer of ₹${ctx.shopperOffer} for an item listed at ₹${ctx.listPrice}.
${ctx.pendingCounter ? `They previously asked to counter at ₹${ctx.pendingCounter} and were asked to confirm. "yes"/"haan"/"confirm" means intent "confirm".` : ""}
approve = accept the shopper's offer. reject = refuse. counter = they name a different price (return it in rupees, e.g. "nineteen thousand" → 19000, "19k" → 19000).
unclear = anything else.`,
      prompt: speech,
    });
    if (output.intent === "counter" && !output.price) return fallback;
    return output.intent === "counter" ? { intent: "counter", price: Math.round(output.price!) } : { intent: output.intent };
  } catch {
    return fallback;
  }
}

export function openingLine(deal: Deal) {
  const n = deal.negotiation!;
  const offer = n.approval!.price;
  const who = n.call?.role === "seller" ? `for ${n.terms.sellerName}` : "for the deal desk";
  return `Hi, GhostCart agent calling ${who}. A shopper offers ${spokenInr(offer)} for ${shortTitle(deal.product.title)}, listed at ${spokenInr(deal.product.price)}. Accept? Say yes, no, or a price. Or press 1 to approve, 2 to reject.`;
}

/** Product titles are long; read the first few words. */
export function shortTitle(title: string) {
  return title
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .split(/,|\||–|\s-\s/)[0]
    .split(/\s+/)
    .slice(0, 6)
    .join(" ")
    .trim();
}
