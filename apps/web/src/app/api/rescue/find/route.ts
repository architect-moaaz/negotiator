import { CART_IMAGE_TYPES, readCartScreenshot, type CartItemRead } from "@ghostcart/agent";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { itemsFromText } from "@/lib/rescue/links";
import { findOffers } from "@/lib/rescue/match";

const MAX_IMAGE_BASE64 = 6_000_000; // about 4.5 MB

/**
 * Rescue my cart: the shopper gives us their marketplace cart (pasted links or names, or a screenshot)
 * and sees which GhostCart sellers have each item to haggle on. Body: { text } or { image: { base64,
 * mediaType } }. Links are never opened; the screenshot is read once and not stored.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { text?: string; image?: { base64?: string; mediaType?: string } };
  const ip = clientIp(request);
  let items: (CartItemRead & { source?: string })[] = [];
  if (body.image?.base64) {
    const limited = await rateLimit({ name: "rescue-read:ip", id: ip, max: 10, windowSeconds: 60 * 60 });
    if (limited) return limited;
    const { base64, mediaType = "" } = body.image;
    if (!(CART_IMAGE_TYPES as readonly string[]).includes(mediaType)) return Response.json({ error: "Send a PNG, JPEG or WebP screenshot." }, { status: 400 });
    if (base64.length > MAX_IMAGE_BASE64) return Response.json({ error: "That image is too big. Try a smaller screenshot." }, { status: 413 });
    items = await readCartScreenshot(base64, mediaType).catch(() => []);
    if (!items.length) return Response.json({ error: "We couldn't read any items in that screenshot. Try pasting the product links instead." }, { status: 422 });
  } else if (typeof body.text === "string" && body.text.trim()) {
    const limited = await rateLimit({ name: "rescue-find:ip", id: ip, max: 60, windowSeconds: 60 * 60 });
    if (limited) return limited;
    items = itemsFromText(body.text.slice(0, 10_000));
    if (!items.length) return Response.json({ error: "Paste product links or names, one per line." }, { status: 400 });
  } else {
    return Response.json({ error: "Paste your cart's product links, or add a screenshot." }, { status: 400 });
  }
  const results = [];
  for (const item of items) results.push({ item, offers: await findOffers({ title: item.title, brand: item.brand, model: item.model }) });
  return Response.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
