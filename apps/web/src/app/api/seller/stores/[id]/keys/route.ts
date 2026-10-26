import { createApiKey, listApiKeys, revokeApiKey, type ApiKeyKind } from "@/lib/integrations/keys";
import { logSellerAction, requireStoreAccess } from "@/lib/shop/access";

export async function GET(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/keys">) {
  const { store, denied } = await requireStoreAccess(request, (await ctx.params).id, "manage");
  if (denied) return denied;
  return Response.json({ keys: await listApiKeys(store.id) }, { headers: { "Cache-Control": "no-store" } });
}

/** Body: { kind: "publishable" | "secret", origins?: string[] }. The full key is in the response once. */
export async function POST(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/keys">) {
  const { store, phone, denied } = await requireStoreAccess(request, (await ctx.params).id, "manage");
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { kind?: ApiKeyKind; origins?: string[] };
  if (body.kind !== "publishable" && body.kind !== "secret") return Response.json({ error: "Pick a key type." }, { status: 400 });
  try {
    const { value, key } = await createApiKey(store, body.kind, phone, body.origins ?? []);
    await logSellerAction(store, phone, `created ${body.kind} API key ${key.prefix}…`);
    return Response.json({ value, key: { ...key, keyHash: undefined } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't create the key." }, { status: 400 });
  }
}

/** ?keyId=… */
export async function DELETE(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/keys">) {
  const { store, phone, denied } = await requireStoreAccess(request, (await ctx.params).id, "manage");
  if (denied) return denied;
  const keyId = new URL(request.url).searchParams.get("keyId") ?? "";
  if (!(await revokeApiKey(store.id, keyId))) return Response.json({ error: "Key not found." }, { status: 404 });
  await logSellerAction(store, phone, `revoked API key ${keyId}`);
  return Response.json({ ok: true });
}
