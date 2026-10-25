import type { ApprovalCall, ListingSeller, NegotiationMessage, Negotiation, Product, SellerQuote } from "@ghostcart/core";

export type {
  AgentRecommendation,
  ApprovalCall,
  ListingSeller,
  Negotiation,
  NegotiationMessage,
  NegotiationTerms,
  Product,
  SellerQuote,
} from "@ghostcart/core";

export type DealInput =
  | { kind: "url"; url: string }
  | { kind: "screenshot"; imageBase64: string; mediaType: string };

export interface Offer {
  originalPrice: number;
  dealPrice: number;
  saved: number;
  perk: string;
  bestSeller: string;
}

/** negotiating → (awaiting_approval →) pending (invoice live, 180s) → paid (locked; checkout opens) | expired */
export type DealStatus = "negotiating" | "awaiting_approval" | "pending" | "paid" | "expired";

/** "whatsapp" deals came from the hackathon Twilio sandbox (removed); the WhatsApp channel returns in Wave 3. */
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
  /** Paid through the test gateway: no money moved. */
  testPayments: boolean;
  createdAt: number;
  expiresAt: number;
  status: DealStatus;
  city?: string;
  channel: Channel;
  userId?: string;
  checkout?: Checkout;
  /** Set when the deal is for a GhostCart Shop product: the seller's list price is the benchmark. */
  shop?: { storeId: string; productId: string; slug: string; storeName: string; returnUrl?: string };
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
export type PublicDeal = Omit<Deal, "pinelabsOrderId" | "userId" | "negotiation" | "checkout"> & {
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

/** What we can learn about a visitor without asking: from IP geo, user agent and the landing URL. */
export interface Demographics {
  city?: string;
  region?: string;
  country?: string;
  device?: "mobile" | "tablet" | "desktop";
  os?: string;
  browser?: string;
  language?: string;
  referrer?: string; // hostname
  source?: string; // ?ref= / utm_source
  hourIst?: number;
}

export interface User {
  id: string;
  name: string;
  phone: string; // E.164, e.g. +919876543210
  email?: string;
  channel: Channel;
  city?: string;
  demographics?: Demographics;
  lastLoginAt?: number;
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
  | "login_code_sent"
  | "login"
  | "logout"
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
  | "negotiation_failed"
  | "staff_login"
  | "staff_action"
  | "staff_denied"
  | "seller_action";

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

/** Anonymous page view (first per path per browser session) for funnel analytics. */
export interface Visit extends Demographics {
  vid: string;
  path: string;
  at: number;
}
