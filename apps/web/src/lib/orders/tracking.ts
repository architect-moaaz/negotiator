/**
 * Courier tracking through a shipping aggregator, so delivery is confirmed by the courier rather than
 * by a status the seller types. Payouts release on this evidence (or the buyer's handover code).
 */
export type TrackingStatus = "in_transit" | "out_for_delivery" | "delivered" | "returned" | "unknown";
export interface TrackingResult {
  status: TrackingStatus;
  deliveredAt?: Date;
  events: { at: string; status: string; note?: string }[];
}

export interface TrackingProvider {
  name: string;
  track(awb: string, courier: string): Promise<TrackingResult>;
  /** One-click pickup: create the shipment, get a courier and AWB, schedule pickup, make the label. */
  book?(req: BookingRequest): Promise<Booking>;
}

export interface BookingRequest {
  orderId: string;
  createdAt: Date;
  pickupLocation: string;
  item: { title: string; sku: string; quantity: number; price: number };
  /** Rupees, what the buyer paid. */
  total: number;
  address: { name: string; phone: string; line1: string; line2?: string; city: string; state: string; pincode: string };
  parcel: { weightKg: number; lengthCm: number; breadthCm: number; heightCm: number };
}

export interface Booking {
  courier: string;
  awb: string;
  ref: string;
  labelUrl?: string;
  pickupAt?: Date;
}

/**
 * Shiprocket, written from its public API documentation (auth/login; courier/track/awb/{awb}; for
 * one-click pickup orders/create/adhoc, courier/assign/awb, courier/generate/pickup and /label).
 * Not yet run against a live account: confirm field names in their sandbox before relying on it.
 */
function shiprocket(email: string, password: string): TrackingProvider {
  const BASE = "https://apiv2.shiprocket.in/v1/external";
  let token: { value: string; until: number } | null = null;
  async function auth() {
    if (token && Date.now() < token.until) return token.value;
    const res = await fetch(`${BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Shiprocket login failed: ${res.status}`);
    const data = (await res.json()) as { token: string };
    token = { value: data.token, until: Date.now() + 9 * 24 * 60 * 60 * 1000 }; // tokens last 10 days
    return token.value;
  }
  async function call<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await auth()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Shiprocket ${path} failed ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text) as T;
  }
  return {
    name: "shiprocket",
    async book(r) {
      const [first, ...rest] = r.address.name.trim().split(/\s+/);
      const created = await call<{ shipment_id?: number }>("/orders/create/adhoc", {
        order_id: r.orderId,
        order_date: r.createdAt.toISOString().slice(0, 16).replace("T", " "),
        pickup_location: r.pickupLocation,
        billing_customer_name: first,
        billing_last_name: rest.join(" ") || ".",
        billing_address: r.address.line1,
        billing_address_2: r.address.line2 ?? "",
        billing_city: r.address.city,
        billing_pincode: r.address.pincode,
        billing_state: r.address.state,
        billing_country: "India",
        billing_phone: r.address.phone.replace(/^\+91/, ""),
        shipping_is_billing: true,
        order_items: [{ name: r.item.title.slice(0, 100), sku: r.item.sku, units: r.item.quantity, selling_price: r.item.price }],
        payment_method: "Prepaid",
        sub_total: r.total,
        length: r.parcel.lengthCm,
        breadth: r.parcel.breadthCm,
        height: r.parcel.heightCm,
        weight: r.parcel.weightKg,
      });
      if (!created.shipment_id) throw new Error("Shiprocket didn't create the shipment.");
      const assigned = await call<{ response?: { data?: { awb_code?: string; courier_name?: string } } }>("/courier/assign/awb", { shipment_id: created.shipment_id });
      const awb = assigned.response?.data?.awb_code;
      if (!awb) throw new Error("No courier could take this parcel. Check the pickup address and pincode in Shiprocket.");
      const pickup = await call<{ response?: { pickup_scheduled_date?: string } }>("/courier/generate/pickup", { shipment_id: [created.shipment_id] }).catch(() => ({ response: undefined }));
      const label = await call<{ label_url?: string }>("/courier/generate/label", { shipment_id: [created.shipment_id] }).catch(() => ({}) as { label_url?: string });
      const when = pickup.response?.pickup_scheduled_date ? new Date(pickup.response.pickup_scheduled_date) : undefined;
      return { courier: assigned.response?.data?.courier_name ?? "Shiprocket", awb, ref: String(created.shipment_id), labelUrl: label.label_url, pickupAt: when && !isNaN(when.getTime()) ? when : undefined };
    },
    async track(awb) {
      const res = await fetch(`${BASE}/courier/track/awb/${encodeURIComponent(awb)}`, { headers: { Authorization: `Bearer ${await auth()}` }, signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`Shiprocket tracking failed: ${res.status}`);
      const data = (await res.json()) as {
        tracking_data?: {
          shipment_track?: { current_status?: string; delivered_date?: string }[];
          shipment_track_activities?: { date: string; activity: string; location?: string }[];
        };
      };
      const current = data.tracking_data?.shipment_track?.[0];
      const s = (current?.current_status ?? "").toLowerCase();
      const status: TrackingStatus = /deliver(ed)?$/.test(s) && !/undeliver/.test(s) ? "delivered" : /out for delivery/.test(s) ? "out_for_delivery" : /rto|return/.test(s) ? "returned" : s ? "in_transit" : "unknown";
      return {
        status,
        deliveredAt: status === "delivered" && current?.delivered_date ? new Date(current.delivered_date) : undefined,
        events: (data.tracking_data?.shipment_track_activities ?? []).map((a) => ({ at: a.date, status: a.activity, note: a.location })),
      };
    },
  };
}

/** Deterministic stand-in for development and tests: AWBs starting ZZDLV are delivered, ZZRTO returned. */
const mock: TrackingProvider = {
  name: "mock",
  async book(r) {
    if (r.address.pincode === "000000") throw new Error("No courier could take this parcel. Check the pickup address and pincode in Shiprocket.");
    return { courier: "ZZ Mock Courier", awb: `ZZSR${r.orderId.replace(/[^A-Za-z0-9]/g, "").slice(-10).toUpperCase()}`, ref: `mock-${r.orderId}`, pickupAt: new Date(Date.now() + 24 * 3600_000) };
  },
  async track(awb) {
    const now = new Date().toISOString();
    if (awb.startsWith("ZZDLV")) return { status: "delivered", deliveredAt: new Date(), events: [{ at: now, status: "Delivered" }] };
    if (awb.startsWith("ZZRTO")) return { status: "returned", events: [{ at: now, status: "RTO delivered to seller" }] };
    return { status: "in_transit", events: [{ at: now, status: "In transit" }] };
  },
};

export function trackingProvider(): TrackingProvider | null {
  if (process.env.SHIPROCKET_EMAIL && process.env.SHIPROCKET_PASSWORD) return shiprocket(process.env.SHIPROCKET_EMAIL, process.env.SHIPROCKET_PASSWORD);
  if (process.env.VERCEL_ENV !== "production") return mock;
  return null; // sellers can still confirm with the buyer's handover code, or the buyer can tap "received"
}
