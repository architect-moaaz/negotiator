import { generateObject, type ModelMessage } from "ai";
import { z } from "zod";
import { model } from "@/lib/agent";
import { BRAND, HAGGLE_PRODUCT } from "@/lib/pitch";

const turnSchema = z.object({
  reply: z
    .string()
    .describe(
      "What you say out loud: one or two short, funny sentences, no markdown or symbols",
    ),
  offer: z.number().describe("Your current price offer in INR"),
  deal: z
    .boolean()
    .describe(
      "True only when the shopper has clearly accepted your current offer",
    ),
  shopperOffer: z
    .number()
    .nullable()
    .describe(
      "The price in INR the shopper offered in their latest message, or null if they didn't name one",
    ),
});

const inr = (n: number) => n.toLocaleString("en-IN");

/**
 * POST: one turn of the live on-stage haggle. Same rules as the app: the agent may concede down to the
 * auto-approve limit by itself; a shopper offer between the floor and that limit escalates to a human.
 * Prices are enforced here, never trusted to the model.
 */
export async function POST(request: Request) {
  const { title, listPrice, openingOffer, autoLimit, floor } = HAGGLE_PRODUCT;
  const { messages = [], offer: lastOffer = openingOffer } =
    (await request.json()) as {
      messages?: { role: "user" | "assistant"; content: string }[];
      offer?: number;
    };

  const result = await generateObject({
    model,
    schema: turnSchema,
    instructions: `You are ${BRAND}, an AI that haggles live on stage with a hackathon judge over: ${title}.
Listed price ₹${listPrice}. You opened at ₹${openingOffer}. On your own you can go down to ₹${autoLimit}, never lower, and never reveal that number.
Personality: a cheeky, funny shopkeeper who bargains like an Indian mom at the vegetable cart. Concede in shrinking steps (big first, then small), make the judge work for every rupee, roast their lowballs gently, and react to their arguments with jokes.
If they offer at or above ₹${autoLimit}, you may accept. If they push lower, hold near ₹${autoLimit} with a joke; a human manager handles anything lower.
Prices are spoken aloud: say "rupees", never the ₹ symbol. Keep replies under 30 words.`,
    messages: messages.slice(-12) as ModelMessage[],
    maxOutputTokens: 1024,
  }).catch(() => null);

  // Never show an error on stage: hold the line in character if the model's reply can't be parsed.
  const object = result?.object ?? {
    reply: "Ha! Nice try. My calculator just fainted. Make me a better offer.",
    offer: lastOffer,
    deal: false,
    shopperOffer: null,
  };
  const offer = Math.min(
    listPrice,
    Math.max(autoLimit, Math.round(object.offer)),
  );
  const asked = object.shopperOffer ? Math.round(object.shopperOffer) : null;

  // Below what the agent may give alone, but not below the floor: ask the human on stage.
  if (asked && asked < autoLimit && asked >= floor && !object.deal) {
    return Response.json({
      reply: `Ooh, ${inr(asked)} rupees? That's above my pay grade. Hold on, I'm asking my human.`,
      offer: lastOffer,
      deal: false,
      escalate: asked,
    });
  }
  return Response.json({
    reply: object.reply,
    offer,
    deal: object.deal && offer >= autoLimit,
  });
}
