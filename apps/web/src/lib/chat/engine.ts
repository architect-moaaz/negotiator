import { inr } from "@ghostcart/core";
import { acceptOffer, HaggleError, submitOffer } from "../negotiate";
import { mayContact } from "../privacy/consent";
import { ShopError, startShopNegotiation } from "../shop/negotiation";
import { getProduct, listProducts } from "../shop/products";
import { getStore } from "../shop/stores";
import { store as kv } from "../store";
import type { Deal } from "../types";
import { readIntent } from "./intent";

/**
 * Haggling in a chat app, the same engine for WhatsApp and Instagram: the shopper picks a product,
 * bargains in plain words, and gets a payment link (or a discount code on Shopify/Woo stores). Every
 * price still comes from the negotiation code; this only translates messages to and from it.
 */
export type ChatChannel = "whatsapp" | "instagram";
export interface IncomingChat {
  channel: ChatChannel;
  storeId: string;
  /** Unique per seller account and shopper, e.g. "<phone_number_id>:<shopper wa id>". */
  threadKey: string;
  /** GhostCart user id for the shopper (WhatsApp: by phone; Instagram: a scoped id). */
  userId: string;
  text: string;
}
type Send = (text: string) => Promise<void>;

interface ThreadState {
  dealId?: string;
  choices?: string[]; // product ids offered in the last menu
}

const stateKey = (c: ChatChannel, threadKey: string) => `chat:${c}:${threadKey}`;
const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const LIVE = new Set(["negotiating", "awaiting_approval", "pending", "granted"]);

/** The latest thing the agent (or the seller) said, to relay to the shopper. */
const lastWord = (deal: Deal) => [...(deal.negotiation?.messages ?? [])].reverse().find((m) => m.from !== "shopper")?.text ?? "";

function afterAgreement(deal: Deal) {
  if (deal.status === "granted" && deal.grant) return `Your one-time code: ${deal.grant.code}\nUse it at ${deal.shop?.storeName}'s checkout within ${Math.round((deal.grant.expiresAt - Date.now()) / 60_000)} minutes: ${deal.grant.checkoutUrl}`;
  if (deal.status === "pending") return `Agreed at ${inr(deal.dealPrice)}. Lock it with a ${inr(deal.lockFee)} UPI payment in the next 3 minutes: ${appUrl()}/deal/${deal.id}`;
  return "";
}

async function menu(storeId: string, threadKey: string, channel: ChatChannel, send: Send, intro: string) {
  const store = await getStore(storeId);
  const products = (await listProducts(storeId, { status: ["active"] })).filter((p) => p.stock > 0).slice(0, 10);
  if (!store || store.status !== "live" || !products.length) {
    await send(`${store?.name ?? "This shop"} isn't taking offers on chat right now. Please check back soon.`);
    return;
  }
  await kv.kvSet<ThreadState>(stateKey(channel, threadKey), { choices: products.map((p) => p.id) }, 24 * 60 * 60);
  const lines = products.map((p, i) => `${i + 1}. ${p.title}, ${inr(p.price)}`);
  await send(`${intro}\n\n${lines.join("\n")}\n\nReply with a number to make an offer.`);
}

async function start(msg: IncomingChat, productId: string, send: Send) {
  try {
    const deal = await startShopNegotiation(productId, msg.userId, { channel: msg.channel, chat: { channel: msg.channel, threadKey: msg.threadKey, storeId: msg.storeId } });
    await kv.kvSet<ThreadState>(stateKey(msg.channel, msg.threadKey), { dealId: deal.id }, 24 * 60 * 60);
    // The example price is based only on the current offer, never on the seller's limits.
    const example = Math.max(1, Math.round((deal.negotiation!.currentOffer * 0.95) / 10) * 10);
    await send(`${lastWord(deal)}\n\nReply with your price (like "${inr(example)}"), or "ok" to take it.`);
  } catch (err) {
    if (err instanceof ShopError) return send(err.message);
    throw err;
  }
}

export async function handleIncomingChat(msg: IncomingChat, send: Send) {
  const state = (await kv.kvGet<ThreadState>(stateKey(msg.channel, msg.threadKey))) ?? {};
  const deal = state.dealId ? await kv.getDeal(state.dealId) : undefined;

  // A GhostCart product link starts a haggle on that product, whatever else is going on.
  const link = msg.text.match(/\/s\/[\w-]+\/(prd_[\w-]+)/);
  if (link) {
    const product = await getProduct(link[1]);
    if (product?.storeId === msg.storeId) return start(msg, product.id, send);
  }

  if (!deal || !LIVE.has(deal.status)) {
    const intent = await readIntent(msg.text, { listPrice: 0, choosing: state.choices?.length });
    if (intent.kind === "pick" && state.choices) return start(msg, state.choices[intent.index], send);
    const store = await getStore(msg.storeId);
    return menu(msg.storeId, msg.threadKey, msg.channel, send, `Hi! I'm the haggling assistant for ${store?.name ?? "this shop"}. Pick something and make me an offer:`);
  }

  if (deal.status === "awaiting_approval") return send(`I've asked ${deal.shop?.storeName ?? "the seller"} about ${inr(deal.negotiation?.approval?.price ?? deal.dealPrice)}. I'll message you here as soon as they reply.`);
  if (deal.status === "pending" || deal.status === "granted") return send(afterAgreement(deal));

  const intent = await readIntent(msg.text, { listPrice: deal.product.price, currentOffer: deal.negotiation?.currentOffer });
  try {
    if (intent.kind === "stop") {
      await kv.kvDel(stateKey(msg.channel, msg.threadKey));
      return send("No problem. Message any time if you change your mind.");
    }
    if (intent.kind === "accept") {
      const updated = await acceptOffer(deal);
      return send(afterAgreement(updated));
    }
    if (intent.kind === "offer") {
      const updated = await submitOffer(deal, intent.amount);
      const agreed = afterAgreement(updated);
      return send(agreed ? `${lastWord(updated)}\n\n${agreed}` : lastWord(updated));
    }
    return send(`Current offer: ${inr(deal.negotiation?.currentOffer ?? deal.dealPrice)}. Reply with your price, "ok" to take it, or "stop".`);
  } catch (err) {
    if (err instanceof HaggleError) return send(err.message);
    throw err;
  }
}

/* ---------- Messages back to the shopper when something happens off-chat (seller decisions) ---------- */

type Transport = (deal: Deal, text: string) => Promise<void>;
const transports = new Map<ChatChannel, Transport>();
export const registerChatTransport = (channel: ChatChannel, t: Transport) => transports.set(channel, t);

/** Tell the shopper, in their chat, what just happened (approval decided, counter-offer). Never throws. */
export async function notifyChat(deal: Deal) {
  if (!deal.chat) return;
  try {
    const user = deal.userId ? await kv.getUser(deal.userId) : undefined;
    if (user && !(await mayContact(user))) return; // they withdrew consent to deal contact
    await import("./transports");
    const transport = transports.get(deal.chat.channel);
    const agreed = afterAgreement(deal);
    if (transport) await transport(deal, agreed ? `${lastWord(deal)}\n\n${agreed}` : lastWord(deal));
  } catch (err) {
    console.error("chat notify failed", err);
  }
}
