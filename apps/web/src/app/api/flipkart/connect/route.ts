import { randomBytes } from "node:crypto";
import { authorizeUrl, flipkartConfigured } from "@/lib/flipkart/api";
import { requireStoreAccess } from "@/lib/shop/access";
import { store as kv } from "@/lib/store";

/** "Connect Flipkart Seller Hub" from the dashboard. ?storeId=… */
export async function GET(request: Request) {
  if (!flipkartConfigured()) return new Response("Flipkart connection isn't configured on this deployment.", { status: 503 });
  const { store, denied } = await requireStoreAccess(request, new URL(request.url).searchParams.get("storeId") ?? "", "manage");
  if (denied) return denied;
  if (store.platform !== "flipkart") return new Response("This store isn't set up as a Flipkart seller store.", { status: 409 });
  const state = randomBytes(16).toString("hex");
  await kv.kvSet(`flipkart:state:${state}`, { storeId: store.id, orgId: store.orgId }, 15 * 60);
  return Response.redirect(authorizeUrl(state), 302);
}
