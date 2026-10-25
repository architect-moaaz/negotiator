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

/** The parts of a GhostCart seller that shape negotiation limits. */
export interface SellerTerms {
  id: string;
  storeName: string;
  budgetPct: number; // max discount the seller funds, as a share of price (0.01-0.3)
  autoApproveShare: number; // share of that budget the agent may give without asking (0.1-1)
}

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

export type Move =
  | { action: "accept"; price: number } // agree at this price
  | { action: "counter"; price: number } // concede to a new offer
  | { action: "final"; price: number } // last offer, at the auto-approve limit
  | { action: "hold"; price: number } // refuse a lowball, no concession
  | { action: "escalate"; price: number }; // ask the human deal desk to approve the shopper's price
