import { anthropic } from "@ai-sdk/anthropic";
import { generateText, Output, streamText } from "ai";
import { z } from "zod";
import { inr } from "./format";
import type { Offer, Product, SellerQuote } from "./types";

export const model = anthropic(process.env.GHOSTCART_MODEL ?? "claude-sonnet-5-5");

const MAX_DISCOUNT = Number(process.env.DEAL_MAX_DISCOUNT_INR ?? 200);
const DISCOUNT_RATE = 0.05;

const productSchema = z.object({
  title: z.string().describe("Concise product name, without marketing fluff"),
  brand: z.string().optional(),
  imageUrl: z.string().optional(),
  seller: z.string().describe("Store / marketplace name, e.g. Amazon, Flipkart, Swiggy"),
  price: z.number().describe("Current selling price in INR, as a plain number"),
  mrp: z.number().optional().describe("List price / MRP in INR if shown"),
  inStock: z.boolean(),
});

export async function extractProductFromText(text: string, sourceUrl: string): Promise<Product> {
  const { output } = await generateText({
    model,
    output: Output.object({ schema: productSchema }),
    maxOutputTokens: 1024,
    instructions: "You extract the primary product being sold on a shopping page. Prices are in INR.",
    prompt: `URL: ${sourceUrl}\n\n${text.slice(0, 20000)}`,
  });
  return { ...output, sourceUrl };
}

export async function extractProductFromImage(imageBase64: string, mediaType: string) {
  const { output } = await generateText({
    model,
    output: Output.object({
      schema: productSchema.extend({
        searchQuery: z.string().describe("Search query that would find this exact product on Indian retailers"),
      }),
    }),
    maxOutputTokens: 1024,
    instructions:
      "You read screenshots of shopping carts, product pages and wishlists. Pick the single most expensive item. Prices are in INR.",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Identify the product and its price." },
          { type: "file", data: imageBase64, mediaType },
        ],
      },
    ],
  });
  const { searchQuery, ...product } = output;
  return { product: product as Product, searchQuery };
}

/** Deterministic pricing: the LLM narrates the deal but never sets the numbers. */
export function computeOffer(product: Product, quotes: SellerQuote[]): Offer {
  const candidates = [{ seller: product.seller, price: product.price }, ...quotes.filter((q) => q.inStock)];
  const best = candidates.reduce((a, b) => (b.price < a.price ? b : a));
  const discount = Math.min(MAX_DISCOUNT, Math.round(best.price * DISCOUNT_RATE));
  const dealPrice = Math.max(1, best.price - discount);
  const originalPrice = Math.max(product.mrp ?? 0, product.price);
  return {
    originalPrice,
    dealPrice,
    saved: originalPrice - dealPrice,
    perk: discount >= 50 ? "Free instant shipping" : "Free shipping + bundled care pack",
    bestSeller: best.seller,
  };
}

function fallbackHaggle(product: Product, quotes: SellerQuote[], offer: Offer) {
  const lines = [
    `Locked onto ${product.title} at ${product.seller} for ${inr(product.price)}.`,
    ...quotes.map((q) => `${q.seller} is quoting ${inr(q.price)}${q.inStock ? "" : " (out of stock)"}.`),
    `Best base price is ${offer.bestSeller}. Pushing for a sub-commission cut…`,
    `Done: ${inr(offer.dealPrice)} + ${offer.perk.toLowerCase()}. You save ${inr(offer.saved)}. Clock starts now.`,
  ];
  return (async function* () {
    for (const line of lines) {
      yield line + "\n";
      await new Promise((r) => setTimeout(r, 350));
    }
  })();
}

/** Stream a short, punchy negotiation narrative built only from the supplied numbers. */
export function streamHaggle(product: Product, quotes: SellerQuote[], offer: Offer): AsyncIterable<string> {
  if (!process.env.ANTHROPIC_API_KEY) return fallbackHaggle(product, quotes, offer);
  const facts = JSON.stringify({
    product: { title: product.title, seller: product.seller, price: product.price, mrp: product.mrp },
    otherSellers: quotes,
    finalOffer: offer,
  });
  const result = streamText({
    model,
    instructions: `You are GhostCart, an AI deal agent haggling live on a shopper's behalf in India.
Write 4-6 short lines (max ~14 words each), one per line, no bullets or markdown.
Narrate: spotting the item, comparing the other sellers' prices, negotiating a tiny sub-commission or bundling an add-on, landing the final offer.
Use ONLY the numbers in the facts, formatted as ₹1,234. Never invent prices, sellers or discounts.
If there are no other sellers, say you checked and the source is already the best base price.
End with the final price, perk and savings, and that the 180-second clock starts now. Confident, fast, a bit cheeky.`,
    prompt: facts,
    maxOutputTokens: 400,
  });
  return result.textStream;
}
