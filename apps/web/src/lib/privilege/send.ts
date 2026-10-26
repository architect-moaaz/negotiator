import type { RecoveryChannel, RecoverySettings } from "@ghostcart/core";
import { emailConfigured, sendEmail, simpleHtml } from "../email";
import { inr } from "../format";
import { sendWhatsAppTemplate, storeWhatsApp } from "../meta/whatsapp";
import { getStore } from "../shop/stores";
import { store as kv } from "../store";
import { placeInviteCall, vobizConfigured } from "../vobiz";
import { updateCart, type CartRow } from "./carts";
import { createInvite, INVITE_HOURS, setInviteStatus, type InviteChannel } from "./invites";

type Store = NonNullable<Awaited<ReturnType<typeof getStore>>>;

/** Invites go out between 09:00 and 21:00 IST only. */
export function withinContactHours(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "numeric", hourCycle: "h23" }).format(now));
  return hour >= 9 && hour < 21;
}

/** The store's Meta template name (or Gupshup template id) for the invite, approved on its own number. */
const templateFor = (meta: Record<string, unknown>) =>
  (typeof meta.privilegeTemplate === "string" && meta.privilegeTemplate) || process.env.WHATSAPP_PRIVILEGE_TEMPLATE || "";

/**
 * Invite calls need TRAI's rules on consented service calls confirmed with Vobiz first (plan, open
 * items), so they stay off unless PRIVILEGE_VOICE_CALLS=1, even when a seller picks them.
 */
const voiceAllowed = () => process.env.PRIVILEGE_VOICE_CALLS === "1" && vobizConfigured;

/**
 * Channels this cart can actually be reached on, in the seller's order of preference: the shopper must
 * have consented and given that contact, and the store must be able to send on it. A call only helps if
 * its "press 1" link can then go by WhatsApp or email.
 */
export async function reachableChannels(cart: CartRow, store: Store, recovery: Pick<RecoverySettings, "channels">): Promise<RecoveryChannel[]> {
  if (!cart.consentAt) return [];
  const wa = cart.phone ? await storeWhatsApp(store.id) : undefined;
  const can: Record<RecoveryChannel, boolean> = {
    email: !!cart.email && emailConfigured(),
    whatsapp: !!cart.phone && !!wa && !!templateFor(wa.meta),
    voice: false,
  };
  can.voice = !!cart.phone && voiceAllowed() && (can.whatsapp || can.email);
  return recovery.channels.filter((c) => can[c]);
}

const itemsText = (cart: CartRow) => {
  const n = cart.lines.reduce((s, l) => s + l.quantity, 0);
  return n === 1 ? cart.lines[0].title : `${n} items`;
};

/** Send one private offer on this cart by the given channel; records the invite and moves the cart on. */
export async function sendInvite(cart: CartRow, store: Store, channel: InviteChannel, now = new Date()) {
  const { invite, token, url } = await createInvite(cart.id, channel, now);
  const until = new Date(now.getTime() + INVITE_HOURS * 3600_000).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const what = itemsText(cart);
  try {
    if (channel === "email") {
      await sendEmail({
        to: cart.email!,
        subject: `A private offer on your cart from ${store.name}`,
        text: [
          `You left ${what} (${inr(cart.subtotal)}) in your cart at ${store.name}.`,
          `As you asked at checkout, here's one private offer: make ${store.name} an offer on the whole cart. Their agent answers straight away.`,
          `Make your offer: ${url}`,
          `The link works until ${until} IST.`,
          `Don't want offers on this cart? Open the link and tap "Stop offers".`,
        ].join("\n\n"),
        html: simpleHtml(
          [`You left ${what} (${inr(cart.subtotal)}) in your cart at ${store.name}.`, `As you asked at checkout, here's one private offer: make ${store.name} an offer on the whole cart. Their agent answers straight away.`],
          { label: "Make your offer", url },
          `The link works until ${until} IST. Don't want offers on this cart? Open the link and tap "Stop offers". Sent by GhostCart for ${store.name}.`,
        ),
        unsubscribeUrl: url,
      });
    } else if (channel === "whatsapp") {
      const wa = await storeWhatsApp(store.id);
      if (!wa || !cart.phone) throw new Error("No WhatsApp number to send from.");
      // Template body: {{1}} store, {{2}} what, {{3}} list total, {{4}} until; URL button …/p/{{1}}.
      await sendWhatsAppTemplate(wa, cart.phone, { template: templateFor(wa.meta), language: process.env.WHATSAPP_PRIVILEGE_TEMPLATE_LANG || "en", body: [store.name, what, inr(cart.subtotal), until], urlSuffix: token });
    } else if (channel === "voice") {
      if (!cart.phone) throw new Error("No phone number to call.");
      await placeInviteCall({ to: cart.phone.replace(/^\+/, ""), inviteId: invite.id });
    } else {
      throw new Error(`Invites don't go out by ${channel}.`);
    }
  } catch (err) {
    await setInviteStatus(invite.id, "failed", String(err instanceof Error ? err.message : err).slice(0, 300));
    throw err;
  }
  await setInviteStatus(invite.id, "sent");
  await updateCart(cart.id, { status: "invited" });
  await kv.log({ type: "privilege_invited", actor: "system", userId: cart.userId ?? undefined, detail: `Private offer sent by ${channel} for cart ${cart.id} (${store.name}, ${inr(cart.subtotal)})` });
  return invite;
}
