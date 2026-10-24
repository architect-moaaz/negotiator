export type DealInput =
  | { kind: "url"; url: string }
  | { kind: "screenshot"; imageBase64: string; mediaType: string };

export interface Product {
  title: string;
  brand?: string;
  imageUrl?: string;
  sourceUrl?: string;
  seller: string;
  price: number; // INR
  mrp?: number;
  inStock: boolean;
}

export interface SellerQuote {
  seller: string;
  url: string;
  price: number;
  inStock: boolean;
}

export interface Offer {
  originalPrice: number;
  dealPrice: number;
  saved: number;
  perk: string;
  bestSeller: string;
}

export type DealStatus = "pending" | "paid" | "expired";
export type Channel = "web" | "whatsapp";

export interface Deal extends Offer {
  id: string;
  product: Product;
  alternatives: SellerQuote[];
  haggle: string;
  lockFee: number; // INR charged via UPI to lock the deal
  upiIntent?: string;
  qrDataUrl?: string;
  pinelabsOrderId?: string;
  simulate: boolean;
  createdAt: number;
  expiresAt: number;
  status: DealStatus;
  city?: string;
  channel: Channel;
  waFrom?: string;
  userId?: string;
}

/** Deal as exposed to browsers: no internal ids or phone numbers. */
export type PublicDeal = Omit<Deal, "pinelabsOrderId" | "waFrom" | "userId">;

export interface TickerEvent {
  id: string;
  message: string;
  city?: string;
  saved: number;
  at: number;
}

export interface Stats {
  users: number;
  deals: number;
  paid: number;
  saved: number;
}

export type NegotiationEvent =
  | { type: "step"; text: string }
  | { type: "product"; product: Product }
  | { type: "quotes"; quotes: SellerQuote[] }
  | { type: "offer"; offer: Offer }
  | { type: "haggle"; text: string }
  | { type: "deal"; deal: PublicDeal }
  | { type: "error"; message: string };

export interface User {
  id: string;
  name: string;
  phone: string; // E.164, e.g. +919876543210
  email?: string;
  channel: Channel;
  city?: string;
  createdAt: number;
}

export type ActivityType =
  | "signup"
  | "negotiation_started"
  | "agent_step"
  | "product_identified"
  | "sellers_compared"
  | "offer_computed"
  | "deal_created"
  | "payment_link_created"
  | "payment_received"
  | "negotiation_failed";

/** Timestamped audit trail: signups, agent actions and payments (proof-of-life export). */
export interface Activity {
  at: number;
  type: ActivityType;
  actor: "user" | "agent" | "system" | "human";
  userId?: string;
  dealId?: string;
  detail: string;
}
