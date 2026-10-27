import { generateText, Output } from "ai";
import { z } from "zod";
import { model } from "./model";

/** One item as the shopper's own cart screenshot shows it. Prices are what the screen says, nothing more. */
export interface CartItemRead {
  title: string;
  brand?: string;
  model?: string;
  /** Unit price shown, in rupees. */
  price?: number;
  quantity: number;
}

const item = z.object({
  title: z.string(),
  brand: z.string().nullable(),
  model: z.string().nullable(),
  price: z.number().nullable(),
  quantity: z.number().nullable(),
});

export const CART_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/**
 * Read the items in a screenshot of a shopping cart the shopper took themselves (Rescue my cart). The
 * model only transcribes what is visible; matching and every price GhostCart offers are decided in code.
 * Returns [] when nothing readable is there, or when no model key is configured.
 */
export async function readCartScreenshot(imageBase64: string, mediaType: string): Promise<CartItemRead[]> {
  if (!process.env.ANTHROPIC_API_KEY || !(CART_IMAGE_TYPES as readonly string[]).includes(mediaType)) return [];
  const { output } = await generateText({
    model,
    maxOutputTokens: 1200,
    output: Output.object({ schema: z.object({ items: z.array(item).max(20) }) }),
    instructions:
      "You read screenshots of online shopping carts. List each product in the cart: its title as shown, the brand and model number only if visible, the unit price in rupees as shown (null if not visible), and the quantity (1 if not shown). Ignore ads, recommendations, 'saved for later' and anything outside the cart. Never guess or invent details.",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Here is my cart. List the items." },
          { type: "image", image: imageBase64, mediaType },
        ],
      },
    ],
  });
  return output.items
    .map((i) => ({
      title: i.title.trim().slice(0, 200),
      brand: i.brand?.trim().slice(0, 60) || undefined,
      model: i.model?.trim().slice(0, 60) || undefined,
      price: i.price && i.price >= 1 && i.price < 10_000_000 ? Math.round(i.price) : undefined,
      quantity: Math.min(10, Math.max(1, Math.round(i.quantity ?? 1))),
    }))
    .filter((i) => i.title.length >= 3);
}
