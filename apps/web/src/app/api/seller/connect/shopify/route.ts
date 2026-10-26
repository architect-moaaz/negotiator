import { memberPhone } from "@/lib/shop/access";
import { createOrg, memberRole, roleCan } from "@/lib/shop/orgs";
import { connectShopifyStore } from "@/lib/shopify/connect";
import { isShopDomain } from "@ghostcart/channels";
import { store as kv } from "@/lib/store";

/** Body: { shop, orgId?, storeId?, businessName?, ownerName? }. Connects an installed shop to a GhostCart store. */
export async function POST(request: Request) {
  const phone = await memberPhone(request);
  if (!phone) return Response.json({ error: "Sign in with your phone number." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { shop?: string; orgId?: string; storeId?: string; businessName?: string; ownerName?: string };
  if (!isShopDomain(body.shop)) return Response.json({ error: "That isn't a Shopify store address." }, { status: 400 });
  let orgId = body.orgId;
  if (orgId) {
    const role = await memberRole(orgId, phone);
    if (!role || !roleCan(role, "manage")) return Response.json({ error: "Only the business owner can connect stores." }, { status: 403 });
  } else {
    if (!body.businessName?.trim() || !body.ownerName?.trim()) return Response.json({ error: "Add your business name and your name." }, { status: 400 });
    orgId = (await createOrg({ name: body.businessName, ownerPhone: phone, ownerName: body.ownerName })).id;
  }
  try {
    const result = await connectShopifyStore({ shop: body.shop, orgId, storeId: body.storeId, by: phone });
    await kv.log({ type: "seller_action", actor: "seller", detail: `${result.store.name} (${result.store.id}) connected to Shopify ${body.shop}; ${result.imported} products imported` });
    return Response.json({ storeId: result.store.id, imported: result.imported, approveBillingUrl: result.approveBillingUrl });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't connect the store." }, { status: 400 });
  }
}
