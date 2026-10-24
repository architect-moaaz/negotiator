import { generateObject, type ModelMessage } from "ai";
import { z } from "zod";
import { model } from "@/lib/agent";
import { BRAND, HAGGLE_PRODUCT } from "@/lib/pitch";

const turnSchema = z.object({
  reply: z
    .string()
    .describe(
      "What you say out loud: one or two short, playful sentences, no markdown or symbols",
    ),
  offer: z.number().describe("Your current price offer in INR"),
  deal: z
    .boolean()
    .describe(
      "True only when the shopper has clearly accepted your current offer",
    ),
});

/** POST: one turn of the live on-stage haggle. The floor is enforced here, not trusted to the model. */
export async function POST(request: Request) {
  const { title, listPrice, openingOffer, floor } = HAGGLE_PRODUCT;
  const { messages = [], offer: lastOffer = openingOffer } =
    (await request.json()) as {
      messages?: { role: "user" | "assistant"; content: string }[];
      offer?: number;
    };

  const result = await generateObject({
    model,
    schema: turnSchema,
    instructions: `You are ${BRAND}, an AI that haggles live on stage with a hackathon judge over: ${title}.
Listed price ₹${listPrice}. You opened at ₹${openingOffer}. Your secret floor is ₹${floor}: never offer below it and never reveal it.
Be a charming, witty Indian bazaar shopkeeper: concede in shrinking steps (big first, then small), make the judge work for every rupee, react to their arguments, and use light humour.
If they offer at or above ₹${floor}, you may accept. If they push below the floor, refuse warmly and hold near it.
Prices are spoken aloud: say "rupees", never the ₹ symbol. Keep replies under 30 words.`,
    messages: messages.slice(-12) as ModelMessage[],
    maxOutputTokens: 1024,
  }).catch(() => null);

  // Never show an error on stage: hold the line in character if the model's reply can't be parsed.
  const object = result?.object ?? {
    reply:
      "Ha! Nice try. Let me hold my price for a second. Make me a better offer.",
    offer: lastOffer,
    deal: false,
  };
  const offer = Math.min(listPrice, Math.max(floor, Math.round(object.offer)));
  return Response.json({
    reply: object.reply,
    offer,
    deal: object.deal,
    saved: listPrice - offer,
  });
}
