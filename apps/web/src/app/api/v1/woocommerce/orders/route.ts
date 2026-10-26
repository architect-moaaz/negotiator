import { redeemGrant } from "@/lib/grants/service";
import { bearer, storeForKey } from "@/lib/integrations/keys";

/** The plugin reports a paid order that used a GhostCart coupon. Body: { code, orderNumber }. */
export async function POST(request: Request) {
  const found = await storeForKey(bearer(request), "secret");
  if (!found) return Response.json({ error: "Invalid or revoked API key." }, { status: 401 });
  const { code, orderNumber } = (await request.json().catch(() => ({}))) as { code?: string; orderNumber?: string };
  if (!code || !/^GC-/i.test(code) || !orderNumber) return Response.json({ error: "Send { code, orderNumber }." }, { status: 400 });
  const deal = await redeemGrant({ storeId: found.store.id, code: code.toUpperCase(), platformOrderRef: `#${orderNumber}` });
  return Response.json({ redeemed: !!deal });
}
