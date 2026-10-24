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
}

/** Deal as exposed to browsers: no internal ids or phone numbers. */
export type PublicDeal = Omit<Deal, "pinelabsOrderId" | "waFrom">;

export interface TickerEvent {
  id: string;
  message: string;
  city?: string;
  saved: number;
  at: number;
}

export interface Stats {
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
