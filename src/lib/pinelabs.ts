import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const BASE_URL = process.env.PINELABS_BASE_URL ?? "https://pluraluat.v2.pinepg.in";

export const pinelabsConfigured = Boolean(process.env.PINELABS_CLIENT_ID && process.env.PINELABS_CLIENT_SECRET);

let cachedToken: { value: string; expiresAt: number } | null = null;

async function call<T>(path: string, init: { method: "GET" | "POST"; body?: unknown; auth?: boolean }): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "Request-ID": randomUUID(),
    "Request-Timestamp": new Date().toISOString(),
  };
  if (init.auth !== false) headers.Authorization = `Bearer ${await getToken()}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method: init.method,
    headers,
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Pine Labs ${init.method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text) as T;
}

async function getToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.value;
  const data = await call<{ access_token: string; expires_at?: string; expires_in?: number }>("/api/auth/v1/token", {
    method: "POST",
    auth: false,
    body: {
      client_id: process.env.PINELABS_CLIENT_ID,
      client_secret: process.env.PINELABS_CLIENT_SECRET,
      grant_type: "client_credentials",
    },
  });
  // Docs disagree on expires_at (ISO) vs expires_in (seconds); accept either, default to 10 minutes.
  const expiresAt = data.expires_at
    ? Date.parse(data.expires_at)
    : Date.now() + (data.expires_in ?? 600) * 1000;
  cachedToken = { value: data.access_token, expiresAt };
  return data.access_token;
}

interface OrderResponse {
  data: { order_id: string; status: string; merchant_order_reference?: string };
}

interface PaymentResponse {
  data: { status: string; challenge_url?: string; image_url?: string };
}

/** Create a UPI-only order and an INTENT payment on it; returns the upi:// link to render as a QR. */
export async function createUpiOrder({ reference, amountInr, note, returnTo = `/deal/${reference}` }: { reference: string; amountInr: number; note: string; returnTo?: string }) {
  const amount = { value: Math.round(amountInr * 100), currency: "INR" };
  const order = await call<OrderResponse>("/api/pay/v1/orders", {
    method: "POST",
    body: {
      merchant_order_reference: reference,
      order_amount: amount,
      allowed_payment_methods: ["UPI"],
      notes: note.slice(0, 100),
      callback_url: `${process.env.NEXT_PUBLIC_APP_URL}${returnTo}`,
    },
  });
  const orderId = order.data.order_id;

  const payment = await call<PaymentResponse>(`/api/pay/v1/orders/${orderId}/payments`, {
    method: "POST",
    body: {
      payments: [
        {
          merchant_payment_reference: `${reference}-upi`,
          payment_amount: amount,
          payment_method: "UPI",
          payment_option: { upi_details: { txn_mode: "INTENT", upi_qr: true } },
        },
      ],
    },
  });
  if (!payment.data.challenge_url) throw new Error("Pine Labs returned no UPI intent (is UPI enabled on this account?)");
  return { orderId, upiIntent: payment.data.challenge_url };
}

export async function getOrderStatus(orderId: string) {
  const order = await call<OrderResponse>(`/api/pay/v1/orders/${orderId}`, { method: "GET" });
  return order.data.status;
}

export const PAID_STATUSES = new Set(["PROCESSED", "AUTHORIZED"]);

/** Verify a Pine Labs (Standard Webhooks style) signature over the raw request body. */
export function verifyWebhook(
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  rawBody: string,
  secret = process.env.PINELABS_WEBHOOK_SECRET,
  toleranceSeconds = 300,
  now = Date.now(),
) {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature) return false;
  if (toleranceSeconds && Math.abs(now / 1000 - Number(timestamp)) > toleranceSeconds) return false;

  const expected = createHmac("sha256", Buffer.from(secret, "base64"))
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest();
  // The header may carry several space-separated "v1,<sig>" entries.
  return signature.split(" ").some((entry) => {
    const received = Buffer.from(entry.split(",", 2)[1] ?? "", "base64");
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
}
