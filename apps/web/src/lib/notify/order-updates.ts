import { sendEmail, simpleHtml } from "../email";
import { inr } from "../format";
import { sendMetaTemplate } from "../meta/whatsapp";
import { mayContact } from "../privacy/consent";
import { notifyBuyer } from "../push";
import { store as kv } from "../store";

/**
 * Shopper order updates: every step of a GhostCart order, once each, on the channels the shopper agreed
 * to at sign-up ("about this deal. No marketing"): app push, WhatsApp from GhostCart's own number (an
 * approved Utility template), and email. A failed channel never blocks the order itself.
 */
export type OrderUpdate = "placed" | "shipped" | "out_for_delivery" | "delivered" | "refunded" | "cancelled";

export interface OrderForUpdate {
  id: string;
  dealId: string;
  userId: string;
  title: string;
  total: number; // paise
}

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

/** What each step says. The same words go to every channel. */
export function orderUpdateText(o: OrderForUpdate, step: OrderUpdate, extra: { courier?: string; awb?: string; refund?: number; reason?: string } = {}) {
  const amount = inr(Math.round(o.total / 100));
  switch (step) {
    case "placed":
      return { title: "Order placed", body: `We've got your order for ${o.title} (${amount}). The seller ships it next; we'll tell you when it's on its way.` };
    case "shipped":
      return { title: "Your order has shipped", body: `${o.title} is on its way${extra.courier ? ` with ${extra.courier}` : ""}${extra.awb ? ` (tracking ${extra.awb})` : ""}.` };
    case "out_for_delivery":
      return { title: "Out for delivery", body: `${o.title} is out for delivery today. Your handover code is on your order page.` };
    case "delivered":
      return { title: "Delivered", body: `${o.title} was delivered. Something wrong with it? Report it from your order page.` };
    case "refunded":
      return { title: "Refund on its way", body: `We've refunded ${inr(Math.round((extra.refund ?? o.total) / 100))} for ${o.title}${extra.reason ? ` (${extra.reason})` : ""}. Banks usually take 5–7 working days.` };
    case "cancelled":
      return { title: "Order cancelled", body: `Your order for ${o.title} was cancelled${extra.reason ? ` (${extra.reason})` : ""} and ${amount} is being refunded. Banks usually take 5–7 working days.` };
  }
}

/** GhostCart's own WhatsApp number for order updates, when one is set up (Meta Cloud API). */
function orderWhatsApp() {
  const phoneId = process.env.WHATSAPP_ORDER_PHONE_ID;
  const token = process.env.WHATSAPP_ORDER_TOKEN;
  const template = process.env.WHATSAPP_ORDER_TEMPLATE;
  return phoneId && token && template ? { phoneId, token, template } : null;
}

export async function notifyShopperOrder(o: OrderForUpdate, step: OrderUpdate, extra: Parameters<typeof orderUpdateText>[2] = {}) {
  try {
    // Once per order and step: retries, webhooks and polling can report the same step again.
    if (!(await kv.claimOnce(`order-update:${o.id}:${step}`, 60 * 24 * 60 * 60))) return { sent: [] as string[] };
    const user = await kv.getUser(o.userId);
    if (!user || !(await mayContact(user))) return { sent: [] as string[] };
    const { title, body } = orderUpdateText(o, step, extra);
    const link = `${appUrl()}/deal/${o.dealId}`;
    const sent: string[] = [];
    const tries: Promise<void>[] = [
      notifyBuyer(o.userId, { title, body, data: { type: "order", dealId: o.dealId } }).then((n) => void (n && sent.push("push"))),
    ];
    const wa = orderWhatsApp();
    if (wa && user.phone && !user.phone.startsWith("erased:")) {
      // Template body: {{1}} what happened, {{2}} details; URL button …/deal/{{1}}.
      tries.push(sendMetaTemplate(wa.phoneId, wa.token, user.phone, { template: wa.template, language: process.env.WHATSAPP_ORDER_TEMPLATE_LANG || "en", body: [title, body], urlSuffix: o.dealId }).then(() => void sent.push("whatsapp")));
    }
    if (user.email) {
      tries.push(
        sendEmail({ to: user.email, subject: `${title}: ${o.title}`, text: `${body}\n\nYour order: ${link}`, html: simpleHtml([body], { label: "View your order", url: link }, "You're getting this because you have an order on GhostCart.") }).then(
          () => void sent.push("email"),
        ),
      );
    }
    const results = await Promise.allSettled(tries);
    for (const r of results) if (r.status === "rejected") console.warn(`order update ${o.id}:${step} failed on a channel`, r.reason);
    return { sent };
  } catch (err) {
    console.warn(`order update ${o.id}:${step} failed`, err);
    return { sent: [] as string[] };
  }
}
