import { completeFlipkartConnect } from "@/lib/flipkart/connect";
import { store as kv } from "@/lib/store";

/** Flipkart sends the seller back with code and state. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  const pending = await kv.kvGet<{ storeId: string; orgId: string }>(`flipkart:state:${state}`);
  await kv.kvDel(`flipkart:state:${state}`);
  if (!pending || !code) return new Response("This Flipkart link has expired. Connect again from your GhostCart dashboard.", { status: 400 });
  try {
    await completeFlipkartConnect({ ...pending, code });
  } catch (err) {
    console.error("Flipkart connect failed", err);
    return new Response("Flipkart didn't accept the connection. Try again from your GhostCart dashboard.", { status: 502 });
  }
  return Response.redirect(new URL(`/seller?store=${pending.storeId}&connected=flipkart`, url.origin), 302);
}
