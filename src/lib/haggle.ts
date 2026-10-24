import { generateText, Output } from "ai";
import { z } from "zod";
import { model } from "./agent";
import { inr } from "./format";
import type { Negotiation, NegotiationTerms, Product, Seller, SellerQuote } from "./types";

/**
 * Estimated affiliate commission GhostCart earns per category. The seller agent can give
 * away up to this much; it's the real money behind every concession. First match wins.
 */
const COMMISSION: [RegExp, number, string][] = [
  [/headphone|earbud|earphone|charger|cable|\bcase\b|cover|power ?bank|speaker|mouse|keyboard|smartwatch|accessor/i, 0.05, "accessories"],
  [/shoe|sneaker|shirt|t-shirt|jeans|dress|kurta|jacket|hoodie|apparel|fashion|\bwatch\b|handbag|backpack|wallet|sunglass/i, 0.08, "fashion"],
  [/lipstick|serum|moisturi[sz]er|cream|beauty|skincare|perfume|shampoo|makeup/i, 0.07, "beauty"],
  [/swiggy|zomato|blinkit|zepto|pizza|burger|biryani|grocery|snack/i, 0.05, "food & grocery"],
  [/kitchen|cookware|decor|furniture|mattress|bedsheet|home/i, 0.05, "home"],
  [/\bbook\b|novel|paperback|hardcover/i, 0.04, "books"],
  [/refrigerator|fridge|washing machine|air conditioner|television|\btv\b|microwave|appliance/i, 0.03, "appliances"],
  [/iphone|smartphone|mobile|laptop|macbook|tablet|ipad|camera|console|playstation/i, 0.025, "phones & computers"],
];
const DEFAULT_RATE: [number, string] = [0.04, "general"];
const MAX_BUDGET = Number(process.env.DEAL_MAX_DISCOUNT_INR ?? 1000);

export const MAX_ROUNDS = 4;
/** Share of the remaining gap to the auto-approve limit the agent concedes in each round. */
const STEP = [0.4, 0.5, 0.6, 1];

export function commissionFor(product: Product): [number, string] {
  const text = `${product.title} ${product.brand ?? ""} ${product.seller}`;
  const hit = COMMISSION.find(([re]) => re.test(text));
  return hit ? [hit[1], hit[2]] : DEFAULT_RATE;
}

/**
 * Negotiation limits. If the listing's seller is on GhostCart, their own margin funds the discount
 * and their auto-approve share applies; otherwise GhostCart's estimated commission does.
 */
export function computeTerms(product: Product, quotes: SellerQuote[], seller?: Seller) {
  const candidates = [{ seller: product.seller, price: product.price }, ...quotes.filter((q) => q.inStock)];
  const best = candidates.reduce((a, b) => (b.price < a.price ? b : a));
  const [commissionRate, category] = commissionFor(product);
  const benchmark = best.price;
  const budget = seller
    ? Math.max(1, Math.round(benchmark * seller.budgetPct))
    : Math.max(1, Math.min(MAX_BUDGET, Math.round(benchmark * commissionRate)));
  const autoShare = seller?.autoApproveShare ?? 0.6;
  const terms: NegotiationTerms = {
    fundedBy: seller ? "seller" : "ghostcart",
    sellerId: seller?.id,
    sellerName: seller?.storeName,
    category,
    commissionRate,
    benchmark,
    budget,
    floor: Math.max(1, benchmark - budget),
    autoLimit: Math.max(1, benchmark - Math.round(budget * autoShare)),
    opening: Math.max(1, benchmark - Math.round(budget * Math.min(0.25, autoShare / 2))),
  };
  return { terms, bestSeller: best.seller, originalPrice: Math.max(product.mrp ?? 0, product.price) };
}

export type Move =
  | { action: "accept"; price: number } // agree at this price
  | { action: "counter"; price: number } // concede to a new offer
  | { action: "final"; price: number } // last offer, at the auto-approve limit
  | { action: "hold"; price: number } // refuse a lowball, no concession
  | { action: "escalate"; price: number }; // ask the human deal desk to approve the shopper's price

/** Moves the agent is allowed to make, in default order of preference. Code sets every number. */
export function candidateMoves(n: Pick<Negotiation, "currentOffer" | "rounds">, terms: NegotiationTerms, offer: number): Move[] {
  const { autoLimit, floor } = terms;
  const lastRound = n.rounds >= MAX_ROUNDS - 1;
  const next = lastRound
    ? autoLimit
    : Math.max(autoLimit, Math.round(n.currentOffer - (n.currentOffer - autoLimit) * STEP[Math.min(n.rounds, STEP.length - 1)]));
  const concede = (price: number): Move => (price <= autoLimit ? { action: "final", price: autoLimit } : { action: "counter", price });

  if (offer >= n.currentOffer) return [{ action: "accept", price: n.currentOffer }];

  if (offer >= next) {
    const moves: Move[] = [{ action: "accept", price: offer }];
    const mid = Math.round((offer + n.currentOffer) / 2);
    if (!lastRound && mid > offer && mid < n.currentOffer) moves.push(concede(mid));
    return moves;
  }

  if (offer >= autoLimit) {
    const moves: Move[] = [concede(next)];
    if (n.rounds >= 2) moves.push({ action: "accept", price: offer });
    return moves;
  }

  if (offer >= floor) {
    const escalate: Move = { action: "escalate", price: offer };
    if (n.currentOffer <= autoLimit) return [escalate]; // nothing left to concede on our own
    return n.rounds >= 2 ? [escalate, concede(next)] : [concede(next), escalate];
  }

  // Below the floor: GhostCart would lose money.
  if (n.currentOffer <= autoLimit) return [{ action: "hold", price: n.currentOffer }];
  return [concede(next), { action: "hold", price: n.currentOffer }];
}

function templateMessage(move: Move, offer: number, terms: NegotiationTerms, bestSeller: string) {
  switch (move.action) {
    case "accept":
      return `Deal. ${inr(move.price)} it is, locking your invoice now.`;
    case "counter":
      return `${inr(offer)} is a stretch when the best price anywhere is ${inr(terms.benchmark)} at ${bestSeller}. I can do ${inr(move.price)}.`;
    case "final":
      return `Final answer: ${inr(move.price)}. That's nearly ${terms.fundedBy === "seller" ? "all the margin I'm allowed to give" : "my whole commission"} on the table.`;
    case "hold":
      return `${inr(offer)} would cost me money. I'm staying at ${inr(move.price)}. Come closer and we'll talk.`;
    case "escalate":
      return terms.fundedBy === "seller"
        ? `${inr(offer)} is more than I can approve on my own. Asking ${terms.sellerName} directly, hang tight.`
        : `${inr(offer)} is more than I can approve on my own. Checking with our deal desk, hang tight.`;
  }
}

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
        marketPrices: [{ seller: product.seller, price: product.price }, ...quotes.map((q) => ({ seller: q.seller, price: q.price }))],
        bestPriceAnywhere: { seller: bestSeller, price: terms.benchmark },
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
