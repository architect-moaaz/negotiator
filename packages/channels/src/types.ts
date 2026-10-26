/** The common shape every channel adapter maps to and from (widget, WhatsApp, Instagram, Shopify, Woo, ONDC, API). */
export type ChannelName = "web" | "whatsapp" | "instagram" | "shopify" | "woocommerce" | "ondc" | "api";

/** A shopper's message arriving on a channel. */
export interface InboundMessage {
  channel: ChannelName;
  /** The conversation on that channel (a phone number, an Instagram user, a session id). */
  threadKey: string;
  storeId: string;
  text: string;
  senderName?: string;
  at: number;
}

/** Sends GhostCart's reply back on the channel the shopper used. */
export type OutboundTransport = (threadKey: string, text: string) => Promise<void>;
