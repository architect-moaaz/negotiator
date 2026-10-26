import { rateLimit } from "@/lib/rate-limit";
import { createSession, handle, sessionView, storeFromKey } from "@/lib/sessions-api";

/**
 * Start a negotiation. Secret key: Authorization: Bearer gc_sk_…
 * Body: { product: "<sku or product id>", shopper: { id: "<your id for the shopper>" }, city? }
 * Returns the session with the agent's opening offer.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const store = await storeFromKey(request);
    const limited = await rateLimit({ name: "v1-sessions:store", id: store.id, max: 600, windowSeconds: 60 });
    if (limited) return limited;
    const deal = await createSession(store.id, await request.json().catch(() => ({})));
    return Response.json(sessionView(deal), { status: 201 });
  });
}
