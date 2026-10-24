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
  title?: string;
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

/** negotiating → (awaiting_approval →) pending (invoice live, 180s) → paid | expired */
export type DealStatus = "negotiating" | "awaiting_approval" | "pending" | "paid" | "expired";

/** Private limits for the seller agent. Never sent to the browser. */
export interface NegotiationTerms {
  category: string;
  commissionRate: number;
  benchmark: number; // cheapest in-stock price we found
  budget: number; // max discount GhostCart can fund from its commission
  floor: number; // benchmark - budget: below this we lose money
  autoLimit: number; // the agent may agree down to here on its own; lower needs human approval
  opening: number;
}

export interface NegotiationMessage {
  from: "agent" | "shopper" | "desk";
  text: string;
  price?: number;
  at: number;
}

export interface Negotiation {
  terms: NegotiationTerms;
  currentOffer: number;
  rounds: number;
  messages: NegotiationMessage[];
  approval?: { price: number; requestedAt: number; decidedAt?: number; decision?: "approved" | "rejected"; decidedBy?: string };
}
export type Channel = "web" | "whatsapp";

export interface Deal extends Offer {
  id: string;
  product: Product;
  alternatives: SellerQuote[];
  haggle: string;
  negotiation?: Negotiation;
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
export interface PublicNegotiation {
  benchmark: number;
  currentOffer: number;
  rounds: number;
  maxRounds: number;
  messages: NegotiationMessage[];
  approvalPrice?: number;
}
export type PublicDeal = Omit<Deal, "pinelabsOrderId" | "waFrom" | "userId" | "negotiation"> & { negotiation?: PublicNegotiation };

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
  | "offer_received"
  | "agent_move"
  | "approval_requested"
  | "approval_decided"
  | "deal_agreed"
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
