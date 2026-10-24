import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";

export const model = anthropic(process.env.GHOSTCART_MODEL ?? "claude-sonnet-5-5");

export const productSchema = z.object({
  title: z.string(),
  brand: z.string().optional(),
  imageUrl: z.string().optional(),
  seller: z.string(),
  price: z.number().describe("Current selling price in INR"),
  mrp: z.number().optional().describe("List price / MRP in INR"),
  inStock: z.boolean(),
});

/** Extract structured product data from scraped page markdown. */
export async function extractProduct(markdown: string, sourceUrl: string) {
  const { object } = await generateObject({
    model,
    schema: productSchema,
    prompt: `Extract the primary product on this page (${sourceUrl}).\n\n${markdown.slice(0, 20000)}`,
  });
  return { ...object, sourceUrl };
}

// TODO: extractFromScreenshot(image) — vision input, same schema
// TODO: findAlternatives(product) — search other sellers, return SellerQuote[]
// TODO: computeOffer(product, alternatives) — discount / bundle within margin
