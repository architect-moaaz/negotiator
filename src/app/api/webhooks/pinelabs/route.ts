import { markPaid } from "@/lib/negotiate";
import { verifyWebhook } from "@/lib/pinelabs";
import { store } from "@/lib/store";

interface PinelabsEvent {
  event_type?: string;
  data?: { merchant_order_reference?: string; status?: string };
}

/** Backup to status polling: Pine Labs ORDER_PROCESSED webhook. */
export async function POST(request: Request) {
  const raw = await request.text();
  const valid = verifyWebhook(
    {
      id: request.headers.get("webhook-id"),
      timestamp: request.headers.get("webhook-timestamp"),
      signature: request.headers.get("webhook-signature"),
    },
    raw,
  );
  if (!valid) return Response.json({ error: "invalid signature" }, { status: 401 });

  const event = JSON.parse(raw) as PinelabsEvent;
  const ref = event.data?.merchant_order_reference;
  if (event.event_type === "ORDER_PROCESSED" && ref) {
    const deal = await store.getDeal(ref);
    if (deal) await markPaid(deal, "pinelabs-webhook");
  }
  return Response.json({ ok: true });
}
