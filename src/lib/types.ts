export type DealInput =
  | { kind: "url"; url: string }
  | { kind: "screenshot"; imageBase64: string; mimeType: string }
  | { kind: "wishlist"; url: string };

export interface Product {
  title: string;
  brand?: string;
  imageUrl?: string;
  sourceUrl: string;
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

export type DealStatus = "pending" | "paid" | "expired";

export interface Deal {
  id: string;
  product: Product;
  alternatives: SellerQuote[];
  originalPrice: number;
  dealPrice: number;
  perk?: string; // e.g. "free shipping", bundled add-on
  paymentUrl?: string;
  upiQrDataUrl?: string;
  createdAt: number;
  expiresAt: number;
  status: DealStatus;
  city?: string;
  channel: "web" | "whatsapp";
}

export interface TickerEvent {
  id: string;
  message: string;
  city?: string;
  saved: number;
  at: number;
}
