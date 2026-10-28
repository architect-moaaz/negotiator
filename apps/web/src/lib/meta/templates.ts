import { graph } from "@ghostcart/channels";

/**
 * WhatsApp template sends through Meta's Cloud API. Kept apart from whatsapp.ts (which wires the chat
 * engine) so order updates can send templates without importing the chat engine.
 */
export interface TemplateMessage {
  /** Meta template name, or Gupshup template id. */
  template: string;
  language?: string;
  body: string[];
  /** Dynamic part of the template's URL button (e.g. the private link token). */
  urlSuffix?: string;
}

/** A template through Meta's Cloud API from a given number (a seller's, or GhostCart's own for order updates). */
export async function sendMetaTemplate(phoneNumberId: string, token: string, to: string, msg: TemplateMessage) {
  const components: unknown[] = [{ type: "body", parameters: msg.body.map((text) => ({ type: "text", text })) }];
  if (msg.urlSuffix) components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: msg.urlSuffix }] });
  await graph(`${phoneNumberId}/messages`, {
    token,
    body: { messaging_product: "whatsapp", recipient_type: "individual", to: to.replace(/^\+/, ""), type: "template", template: { name: msg.template, language: { code: msg.language ?? "en" }, components } },
  });
}
