import { z } from "zod";
import { logSellerAction, memberPhone } from "@/lib/shop/access";
import { createOrg, memberRole, roleCan } from "@/lib/shop/orgs";
import { PolicyError, setPolicy } from "@/lib/shop/policies";
import { createStore, PLATFORMS } from "@/lib/shop/stores";

const NEEDS_DOMAIN = new Set(["website", "shopify", "woocommerce"]);

const input = z.object({
  orgId: z.string().optional(),
  businessName: z.string().trim().min(2, "Add your business name.").max(80).optional(),
  ownerName: z.string().trim().min(2, "Add your name.").max(80).optional(),
  storeName: z.string().trim().min(2, "Add a store name.").max(80),
  platform: z.enum(PLATFORMS as [string, ...string[]], { error: "Pick how you sell." }),
  domain: z.string().trim().max(120).optional(),
  maxDiscountPct: z.coerce.number().min(0).max(90),
  autoApprovePct: z.coerce.number().min(0).max(90),
});

/** "https://www.Shop.in/products" → "shop.in"; null if it isn't a plausible domain. */
function cleanDomain(raw: string | undefined) {
  if (!raw) return null;
  const host = raw.trim().toLowerCase().replace(/^https?:\/\//, "").split(/[/?#]/)[0].replace(/^www\./, "");
  return /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(host) ? host : null;
}

/** Onboarding: a new business (or a new store in an existing one) with its default discount rules. */
export async function POST(request: Request) {
  const phone = await memberPhone(request);
  if (!phone) return Response.json({ error: "Sign in with your phone number." }, { status: 401 });
  const parsed = input.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Check the details." }, { status: 400 });
  const body = parsed.data;

  const domain = cleanDomain(body.domain);
  if (NEEDS_DOMAIN.has(body.platform) && !domain) return Response.json({ error: "Add your website address, like sharmaelectronics.in." }, { status: 400 });

  let orgId = body.orgId;
  if (orgId) {
    const role = await memberRole(orgId, phone);
    if (!role || !roleCan(role, "manage")) return Response.json({ error: "Only the business owner can add stores." }, { status: 403 });
  } else {
    if (!body.businessName || !body.ownerName) return Response.json({ error: "Add your business name and your name." }, { status: 400 });
    orgId = (await createOrg({ name: body.businessName, ownerPhone: phone, ownerName: body.ownerName })).id;
  }

  const store = await createStore({ orgId, name: body.storeName, platform: body.platform as (typeof PLATFORMS)[number], domain: domain ?? undefined });
  try {
    await setPolicy(store.id, "store", null, { maxDiscountPct: body.maxDiscountPct, autoApprovePct: body.autoApprovePct });
  } catch (err) {
    if (err instanceof PolicyError) return Response.json({ error: err.message, storeId: store.id }, { status: 400 });
    throw err;
  }
  await logSellerAction(store, phone, `created ${body.platform} store; up to ${body.maxDiscountPct}% off, agent alone ${body.autoApprovePct}%`);
  return Response.json({ store: { id: store.id, slug: store.slug, name: store.name, platform: store.platform, status: store.status } });
}
