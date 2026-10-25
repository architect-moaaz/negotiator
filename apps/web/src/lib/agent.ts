import { anthropic } from "@ai-sdk/anthropic";
import { generateText, Output, streamText } from "ai";
import { z } from "zod";
import { inr, shortTitle } from "./format";
import type { Offer, Product, SellerQuote } from "./types";

export const model = anthropic(process.env.GHOSTCART_MODEL ?? "claude-sonnet-5-5");

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

function fallbackHaggle(product: Product, quotes: SellerQuote[], offer: Offer, sellerName?: string) {
  const lines = [
    `Locked onto ${shortTitle(product.title)} at ${product.seller} for ${inr(product.price)}.`,
    ...quotes.map((q) => `${q.seller} is quoting ${inr(q.price)}${q.inStock ? "" : " (out of stock)"}.`),
    sellerName
      ? `Good news: the seller, ${sellerName}, is on GhostCart. I'm negotiating with their margin directly.`
      : `Best price anywhere is ${offer.bestSeller}. I'll cut into our own commission for you.`,
    `Opening offer: ${inr(offer.dealPrice)}. Counter me.`,
  ];
  return (async function* () {
    for (const line of lines) {
      yield line + "\n";
      await new Promise((r) => setTimeout(r, 350));
    }
  })();
}

/** Stream the seller agent's opening: market comparison and opening offer, built only from the supplied numbers. */
export function streamHaggle(product: Product, quotes: SellerQuote[], offer: Offer, sellerName?: string): AsyncIterable<string> {
  if (!process.env.ANTHROPIC_API_KEY) return fallbackHaggle(product, quotes, offer, sellerName);
  const facts = JSON.stringify({
    product: { title: product.title, seller: product.seller, price: product.price, mrp: product.mrp },
    otherSellers: quotes,
    openingOffer: { price: offer.dealPrice, bestPriceAnywhere: offer.bestSeller },
    discountFundedBy: sellerName ? `${sellerName} (the listing's seller, who is on GhostCart)` : "GhostCart's own commission",
  });
  const result = streamText({
    model,
    instructions: `You are GhostCart, an AI deal agent haggling live on a shopper's behalf in India.
Write 4-6 short lines (max ~14 words each), one per line, no bullets or markdown.
Narrate: spotting the item, comparing the other sellers' prices, then making your opening offer, funded as stated in discountFundedBy. If the listing's seller is on GhostCart, say you're negotiating with them directly.
Use ONLY the numbers in the facts, formatted as ₹1,234. Never invent prices, sellers or discounts.
If there are no other sellers, say you checked and the source is already the best price.
End with the opening offer and invite the shopper to counter. Confident, fast, a bit cheeky. You are the seller side: you want to win the deal but protect margin.`,
    prompt: facts,
    maxOutputTokens: 400,
  });
  return result.textStream;
}
