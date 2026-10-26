import { addWebhookEndpoint, listWebhookEndpoints, removeWebhookEndpoint, sendTestWebhook, WebhookError } from "@/lib/integrations/webhooks";
import { logSellerAction, requireStoreAccess } from "@/lib/shop/access";

export async function GET(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/webhooks">) {
  const { store, denied } = await requireStoreAccess(request, (await ctx.params).id, "manage");
  if (denied) return denied;
  return Response.json({ endpoints: await listWebhookEndpoints(store.id) }, { headers: { "Cache-Control": "no-store" } });
}

/** Body: { url, events? } to add (secret returned once) | { action: "test" | "remove", endpointId }. */
export async function POST(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/webhooks">) {
  const { store, phone, denied } = await requireStoreAccess(request, (await ctx.params).id, "manage");
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { url?: string; events?: string[]; action?: string; endpointId?: string };
  try {
    if (body.action === "test") return Response.json({ delivery: await sendTestWebhook(store.id, body.endpointId ?? "") });
    if (body.action === "remove") {
      await removeWebhookEndpoint(store.id, body.endpointId ?? "");
      return Response.json({ ok: true });
    }
    const created = await addWebhookEndpoint(store.id, body.url ?? "", body.events);
    await logSellerAction(store, phone, `added webhook endpoint ${created.endpoint.url}`);
    return Response.json(created);
  } catch (err) {
    if (err instanceof WebhookError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
