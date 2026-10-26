import { connectInstagram } from "@/lib/meta/instagram";
import { store as kv } from "@/lib/store";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  const storeId = await kv.kvGet<string>(`instagram:state:${state}`);
  await kv.kvDel(`instagram:state:${state}`);
  if (!storeId || !code) return new Response("This Instagram link has expired. Connect again from your GhostCart dashboard.", { status: 400 });
  try {
    const { username } = await connectInstagram({ storeId, code });
    await kv.log({ type: "seller_action", actor: "seller", detail: `${storeId} connected Instagram @${username}` });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "Instagram didn't accept the connection.", { status: 400 });
  }
  return Response.redirect(new URL(`/seller?store=${storeId}&connected=instagram`, url.origin), 302);
}
