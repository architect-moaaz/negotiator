/** The parts of the API's responses the app uses (see apps/web/src/lib/types.ts PublicDeal). */
export type DealStatus = "negotiating" | "awaiting_approval" | "pending" | "paid" | "granted" | "expired";

export interface Message {
  from: "shopper" | "agent" | "desk" | "seller";
  text: string;
  price?: number;
  at: number;
}

export interface Deal {
  id: string;
  status: DealStatus;
  product: { title: string; image?: string };
  originalPrice: number;
  dealPrice: number;
  saved: number;
  lockFee: number;
  expiresAt: number;
  testPayments: boolean;
  upiIntent?: string;
  shop?: { storeName: string; slug: string };
  negotiation?: { currentOffer: number; benchmark: number; rounds: number; maxRounds: number; messages: Message[]; approvalPrice?: number; sellerName?: string };
  checkout?: {
    status: "awaiting" | "ordered" | "lapsed";
    dueAt: number;
    amount: number;
    upiIntent?: string;
    orderRef?: string;
    deliverTo?: { name: string; area: string };
    tracking?: { stage: string; at: number; note?: string }[];
    courier?: string;
    awb?: string;
  };
}

export interface CatalogueItem {
  productId: string;
  title: string;
  price: number;
  mrp: number | null;
  image: string | null;
  storeName: string;
  storeSlug: string;
}

export interface SellerAccount {
  phone: string;
  orgs: { id: string; name: string; role: string; stores: { id: string; name: string; status: string }[] }[];
}
