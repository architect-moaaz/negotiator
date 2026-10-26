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
}

/**
 * Shiprocket, written from its public API documentation (auth/login, then courier/track/awb/{awb}).
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
  return {
    name: "shiprocket",
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
