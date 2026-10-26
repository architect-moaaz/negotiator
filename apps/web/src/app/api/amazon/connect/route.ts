import { randomBytes } from "node:crypto";
import { amazonConfigured, consentUrl } from "@/lib/amazon/spapi";
import { requireStoreAccess } from "@/lib/shop/access";
import { store as kv } from "@/lib/store";

/** "Connect Amazon Seller Central" from the dashboard. ?storeId=… */
export async function GET(request: Request) {
  if (!amazonConfigured()) return new Response("Amazon connection isn't configured on this deployment.", { status: 503 });
  const storeId = new URL(request.url).searchParams.get("storeId") ?? "";
  const { store, denied } = await requireStoreAccess(request, storeId, "manage");
  if (denied) return denied;
  if (store.platform !== "amazon") return new Response("This store isn't set up as an Amazon seller store.", { status: 409 });
  const state = randomBytes(16).toString("hex");
  await kv.kvSet(`amazon:state:${state}`, { storeId: store.id, orgId: store.orgId }, 15 * 60);
  return Response.redirect(consentUrl(state), 302);
}
