import { store } from "./store";

/**
 * Stand-in for the Pine Labs Online UAT gateway, enabled with PINELABS_MODE=mock. It serves the same
 * endpoints and response shapes our client uses, so swapping in real UAT keys is env-only.
 */
export const pinelabsMockEnabled = process.env.PINELABS_MODE === "mock";

export type MockOrderStatus = "CREATED" | "PENDING" | "PROCESSED" | "FAILED";

export interface MockOrder {
  order_id: string;
  merchant_order_reference: string;
  order_amount: { value: number; currency: string };
  notes?: string;
  status: MockOrderStatus;
  created_at: string;
  updated_at: string;
}

const key = (id: string) => `mockpl:order:${id}`;
const now = () => new Date().toISOString();

export async function mockCreateOrder(body: { merchant_order_reference?: string; order_amount?: { value: number; currency: string }; notes?: string }) {
  if (!body.merchant_order_reference || !body.order_amount?.value) throw new Error("merchant_order_reference and order_amount are required");
  const order: MockOrder = {
    order_id: `v1-mock-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`,
    merchant_order_reference: body.merchant_order_reference,
    order_amount: body.order_amount,
    notes: body.notes,
    status: "CREATED",
    created_at: now(),
    updated_at: now(),
  };
  await store.kvSet(key(order.order_id), order);
  return order;
}

export async function mockGetOrder(id: string) {
  return store.kvGet<MockOrder>(key(id));
}

export async function mockSetStatus(id: string, status: MockOrderStatus) {
  const order = await mockGetOrder(id);
  if (!order) return undefined;
  Object.assign(order, { status, updated_at: now() });
  await store.kvSet(key(id), order);
  return order;
}

/** The "UPI intent" the QR encodes: our hosted test payment page, so a phone camera can open it. */
export const mockPaymentUrl = (orderId: string) => `${process.env.NEXT_PUBLIC_APP_URL}/pay/mock/${encodeURIComponent(orderId)}`;
