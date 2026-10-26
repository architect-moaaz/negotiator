import { completeAmazonConnect } from "@/lib/amazon/connect";
import { store as kv } from "@/lib/store";

/** Amazon sends the seller back with spapi_oauth_code, state and selling_partner_id. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("spapi_oauth_code");
  const sellingPartnerId = url.searchParams.get("selling_partner_id");
  const pending = await kv.kvGet<{ storeId: string; orgId: string }>(`amazon:state:${state}`);
  await kv.kvDel(`amazon:state:${state}`);
  if (!pending || !code || !sellingPartnerId) return new Response("This Amazon link has expired. Connect again from your GhostCart dashboard.", { status: 400 });
  try {
    await completeAmazonConnect({ ...pending, code, sellingPartnerId });
  } catch (err) {
    console.error("Amazon connect failed", err);
    return new Response("Amazon didn't accept the connection. Try again from your GhostCart dashboard.", { status: 502 });
  }
  return Response.redirect(new URL(`/seller?store=${pending.storeId}&connected=amazon`, url.origin), 302);
}
