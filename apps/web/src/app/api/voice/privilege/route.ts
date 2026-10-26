import { stopCart } from "@/lib/privilege/actions";
import { getCart, RECOVERABLE, type CartStatus } from "@/lib/privilege/carts";
import { getInvite } from "@/lib/privilege/invites";
import { reachableChannels, sendInvite } from "@/lib/privilege/send";
import { getStore } from "@/lib/shop/stores";
import { gatherKeys, hangup, privilegeVoiceUrl, speak, spokenInr, verifyPrivilegeSignature, xml } from "@/lib/vobiz";

/**
 * Vobiz answer URL for GhostCart Privilege invite calls. The call only offers a choice: press 1 to get the
 * private link by WhatsApp or email, press 9 to stop offers on this cart. No haggling happens on the call.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("i");
  if (!verifyPrivilegeSignature(id, url.searchParams.get("k"))) return new Response("forbidden", { status: 403 });
  const invite = await getInvite(id!);
  const cart = invite && (await getCart(invite.cartId));
  const store = cart && (await getStore(cart.storeId));
  if (!invite || !cart || !store || !RECOVERABLE.includes(cart.status as CartStatus)) {
    return xml(speak("Sorry, this offer isn't available any more. Goodbye.") + hangup());
  }
  const items = cart.lines.reduce((s, l) => s + l.quantity, 0);
  const what = items === 1 ? cart.lines[0].title : `${items} items`;

  if (url.searchParams.get("s") !== "keys") {
    const prompt = `Hello, this is GhostCart calling for ${store.name}. You left ${what}, worth ${spokenInr(cart.subtotal)}, in your cart, and said they could send you a private offer. Press 1 and we'll send you a private link to make your offer. Press 9 to stop offers on this cart.`;
    return xml(gatherKeys(prompt, privilegeVoiceUrl(invite.id, "keys")) + speak("We didn't get a key press. Goodbye.") + hangup());
  }

  const digit = String((await request.formData()).get("Digits") ?? "").trim();
  if (digit === "9") {
    await stopCart(cart, store.name, "voice_keypress");
    return xml(speak(`Done. ${store.name} won't send you offers on this cart again. Goodbye.`) + hangup());
  }
  if (digit === "1") {
    const follow = (await reachableChannels(cart, store, { channels: ["whatsapp", "email"] }))[0];
    if (!follow) return xml(speak("Sorry, we couldn't send the link just now. Goodbye.") + hangup());
    await sendInvite(cart, store, follow);
    return xml(speak(`Done. Your private link is on its way by ${follow === "whatsapp" ? "WhatsApp" : "email"}. Goodbye.`) + hangup());
  }
  return xml(speak("Sorry, we didn't get that. Goodbye.") + hangup());
}
