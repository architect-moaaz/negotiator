export type DealInput =
  | { kind: "url"; url: string }
  | { kind: "screenshot"; imageBase64: string; mediaType: string };

/** The marketplace merchant actually selling the listing ("Sold by …"). */
export interface ListingSeller {
  name: string;
  marketplace: string; // Amazon, Flipkart, …
  marketplaceSellerId?: string;
  rating?: number;
}

export interface Product {
  title: string;
  soldBy?: ListingSeller;
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

/** negotiating → (awaiting_approval →) pending (invoice live, 180s) → paid (locked; checkout opens) | expired */
export type DealStatus = "negotiating" | "awaiting_approval" | "pending" | "paid" | "expired";

/** Private limits for the seller agent. Never sent to the browser. */
export interface NegotiationTerms {
  fundedBy: "ghostcart" | "seller";
  sellerId?: string; // set when the listing's seller is on GhostCart
  sellerName?: string;
  category: string;
  commissionRate: number;
  benchmark: number; // cheapest in-stock price we found
  budget: number; // max discount GhostCart can fund from its commission
  floor: number; // benchmark - budget: below this we lose money
  autoLimit: number; // the agent may agree down to here on its own; lower needs human approval
  opening: number;
}

export interface NegotiationMessage {
  from: "agent" | "shopper" | "desk" | "seller";
  text: string;
  price?: number;
  at: number;
}

export interface Negotiation {
  terms: NegotiationTerms;
  currentOffer: number;
  rounds: number;
  messages: NegotiationMessage[];
  approval?: { price: number; requestedAt: number; decidedAt?: number; decision?: "approved" | "rejected" | "countered"; decidedBy?: string };
  /** Voice call to the approver (seller or deal desk) via Vobiz. */
  call?: ApprovalCall;
  /** Deal-desk agent's recommendation (AgenticOrg); a human still makes the call. */
  recommendation?: AgentRecommendation;
}

export interface AgentRecommendation {
  decision: "approve" | "reject" | "counter";
  price?: number; // for counter
  confidence: number; // 0-1
  reasoning: string;
  source: string; // e.g. "agenticorg"
  at: number;
}

export interface ApprovalCall {
  status: "calling" | "in_progress" | "completed" | "failed";
  to: string;
  role: "seller" | "desk";
  callUuid?: string;
  turns: number;
  pendingCounter?: number; // price the approver asked for, awaiting their confirmation
  transcript: { from: "agent" | "approver"; text: string; at: number }[];
  startedAt: number;
}
export type Channel = "web" | "whatsapp";

export interface DeliveryAddress {
  name: string;
  phone: string; // E.164
  line1: string;
  line2?: string;
  landmark?: string;
  city: string;
  state: string;
  pincode: string;
}

export type FulfilmentStage = "placed" | "confirmed" | "shipped" | "out_for_delivery" | "delivered";

export interface TrackingEvent {
  stage: FulfilmentStage;
  at: number;
  note?: string;
}

/**
 * After the lock fee is paid the shopper has 30 minutes to give a delivery address and pay the balance
 * (deal price minus the lock fee). awaiting → ordered | lapsed.
 */
export interface Checkout {
  status: "awaiting" | "ordered" | "lapsed";
  openedAt: number;
  dueAt: number;
  amount: number; // INR balance still to pay
  address?: DeliveryAddress;
  addressAt?: number;
  pinelabsOrderId?: string;
  upiIntent?: string;
  qrDataUrl?: string;
  paidAt?: number;
  orderRef?: string; // GhostCart order number shown to the shopper
  deliveryBy?: number; // estimated delivery date
  tracking?: TrackingEvent[]; // oldest first; the last entry is the current stage
  courier?: string;
  awb?: string; // courier tracking number
}

/** Checkout as exposed to browsers: the address is reduced to a "delivering to" summary. */
export type PublicCheckout = Omit<Checkout, "address" | "pinelabsOrderId"> & {
  deliverTo?: { name: string; area: string };
};

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
  checkout?: Checkout;
}

/** Deal as exposed to browsers: no internal ids or phone numbers. */
export interface PublicNegotiation {
  fundedBy: "ghostcart" | "seller";
  sellerName?: string;
  benchmark: number;
  currentOffer: number;
  rounds: number;
  maxRounds: number;
  messages: NegotiationMessage[];
  approvalPrice?: number;
  callStatus?: ApprovalCall["status"];
  reviewedByAgent?: boolean;
}
export type PublicDeal = Omit<Deal, "pinelabsOrderId" | "waFrom" | "userId" | "negotiation" | "checkout"> & {
  negotiation?: PublicNegotiation;
  checkout?: PublicCheckout;
};

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
  | { type: "seller"; soldBy: ListingSeller; onGhostCart: boolean; sellerName?: string }
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
  /** When the shopper agreed to be contacted about their deals (calls, messages). */
  consentAt?: number;
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
  | "seller_identified"
  | "agent_review_requested"
  | "agent_recommendation"
  | "approval_call_placed"
  | "approval_call_turn"
  | "approval_call_ended"
  | "seller_signup"
  | "deal_created"
  | "payment_link_created"
  | "payment_received"
  | "checkout_opened"
  | "address_received"
  | "order_placed"
  | "checkout_lapsed"
  | "order_status"
  | "negotiation_failed";

/** Timestamped audit trail: signups, agent actions and payments (proof-of-life export). */
export interface Activity {
  at: number;
  type: ActivityType;
  actor: "user" | "agent" | "system" | "human" | "seller";
  userId?: string;
  dealId?: string;
  detail: string;
}

/** A merchant who opted in to GhostCart and negotiates from their own margin. */
export interface Seller {
  id: string;
  storeName: string;
  aliases: string[]; // store names as shown on marketplaces ("Clicktech Retail Private Ltd")
  contactName: string;
  phone: string;
  budgetPct: number; // max discount the seller funds, as a share of price (0.01-0.3)
  autoApproveShare: number; // share of that budget the agent may give without asking (0.1-1)
  createdAt: number;
}

export interface SellerDemand {
  key: string;
  name: string;
  marketplace: string;
  count: number;
  registered: boolean;
}
