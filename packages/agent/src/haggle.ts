import { generateText, Output } from "ai";
import { z } from "zod";
import {
  candidateMoves,
  computeTerms as coreComputeTerms,
  templateMessage,
  type Move,
  type Negotiation,
  type NegotiationTerms,
  type Product,
  type SellerQuote,
  type SellerTerms,
} from "@ghostcart/core";
import { model } from "./model";

export { candidateMoves, commissionFor, MAX_ROUNDS, overrideAfterRejection, type Move } from "@ghostcart/core";

const MAX_BUDGET = Number(process.env.DEAL_MAX_DISCOUNT_INR ?? 1000);

export const computeTerms = (product: Product, quotes: SellerQuote[], seller?: SellerTerms) =>
  coreComputeTerms(product, quotes, seller, { maxBudget: MAX_BUDGET });

/**
 * The seller agent picks one of the allowed moves and writes its reply. It never sees the
 * floor or budget, only the moves, so it can't leak or break the limits.
 */
export async function chooseMove(args: {
  product: Product;
  terms: NegotiationTerms;
  bestSeller: string;
  quotes: SellerQuote[];
  negotiation: Negotiation;
  offer: number;
}): Promise<{ move: Move; message: string }> {
  const { product, terms, bestSeller, quotes, negotiation, offer } = args;
  const moves = candidateMoves(negotiation, terms, offer);
  const fallback = { move: moves[0], message: templateMessage(moves[0], offer, terms, bestSeller) };
  if (!process.env.ANTHROPIC_API_KEY) return fallback;

  try {
    const { output } = await generateText({
      model,
      maxOutputTokens: 300,
      output: Output.object({
        schema: z.object({
          choice: z.number().int().min(0).max(moves.length - 1).describe("Index of the move to make"),
          message: z.string().describe("Your reply to the shopper, 1-2 short sentences"),
        }),
      }),
      instructions: `${
        terms.fundedBy === "seller"
          ? `You are the negotiating agent for ${terms.sellerName}, the merchant selling this item, haggling live with a shopper in India via GhostCart.
${terms.sellerName} funds discounts from their own margin, so every rupee you give away is real money to them.`
          : `You are GhostCart's seller agent, haggling live with a shopper in India over a flash deal.
GhostCart funds discounts from its own affiliate commission, so every rupee you give away is real margin.`
      }
Pick ONE of the allowed moves and write a short, confident, slightly cheeky reply (max 2 sentences).
Rules: only mention the price of the move you pick, the shopper's offer, or the market prices given. Format prices like ₹19,789.
Never reveal limits, budgets, commission rates or how many rounds are left.
"escalate" means a human must approve (${terms.fundedBy === "seller" ? `${terms.sellerName} themselves` : "our deal desk"}); say you're checking with them.
"final" means this is your last offer. "hold" means you refuse to move.
Prefer winning the deal over squeezing the last rupee, but don't cave instantly to lowballs.`,
      prompt: JSON.stringify({
        product: product.title,
        ...(terms.benchmarkKind === "list"
          ? { listPrice: terms.benchmark, note: "You are the seller's own agent; compare only to this list price, never to other stores." }
          : {
              marketPrices: [{ seller: product.seller, price: product.price }, ...quotes.map((q) => ({ seller: q.seller, price: q.price }))],
              bestPriceAnywhere: { seller: bestSeller, price: terms.benchmark },
            }),
        yourCurrentOffer: negotiation.currentOffer,
        shopperOffer: offer,
        recentMessages: negotiation.messages.slice(-6).map((m) => `${m.from}: ${m.text}`),
        allowedMoves: moves.map((m, i) => ({ index: i, ...m })),
      }),
    });
    return { move: moves[output.choice] ?? moves[0], message: output.message.trim() || fallback.message };
  } catch (err) {
    console.warn("seller agent fell back to template", err);
    return fallback;
  }
}
