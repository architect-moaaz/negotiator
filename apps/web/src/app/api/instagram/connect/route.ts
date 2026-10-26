import { randomBytes } from "node:crypto";
import { instagramLoginUrl } from "@/lib/meta/instagram";
import { metaConfigured } from "@ghostcart/channels";
import { requireStoreAccess } from "@/lib/shop/access";
import { store as kv } from "@/lib/store";

/** "Connect Instagram" from the dashboard: Facebook Login for Business. ?storeId=… */
export async function GET(request: Request) {
  if (!metaConfigured()) return new Response("Instagram connection isn't configured on this deployment.", { status: 503 });
  const { store, denied } = await requireStoreAccess(request, new URL(request.url).searchParams.get("storeId") ?? "", "manage");
  if (denied) return denied;
  const state = randomBytes(16).toString("hex");
  await kv.kvSet(`instagram:state:${state}`, store.id, 15 * 60);
  return Response.redirect(instagramLoginUrl(state), 302);
}
