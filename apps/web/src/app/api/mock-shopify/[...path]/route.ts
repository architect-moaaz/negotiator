import { createHmac } from "node:crypto";
import { shopifyConfig } from "@/lib/shopify/config";
import { store as kv } from "@/lib/store";

/**
 * Development stand-in for a Shopify store's OAuth and Admin GraphQL, covering exactly the calls
 * GhostCart makes, so the install → connect → haggle → code → order flow runs without a Partner store.
 * Point SHOPIFY_ADMIN_BASE at <app>/api/mock-shopify. Never available in production.
 */
const off = () => process.env.VERCEL_ENV === "production" || !process.env.SHOPIFY_ADMIN_BASE;
type Ctx = { params: Promise<{ path: string[] }> };

const PRODUCTS = [
  { id: "gid://shopify/Product/9001", title: "ZZ Mock Kurta, Cotton", price: "1499.00", compareAt: "1999.00", stock: 12, variant: "gid://shopify/ProductVariant/7001" },
  { id: "gid://shopify/Product/9002", title: "ZZ Mock Steel Bottle 1L", price: "699.00", compareAt: null, stock: 40, variant: "gid://shopify/ProductVariant/7002" },
];

function sign(params: URLSearchParams) {
  const message = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
  return createHmac("sha256", shopifyConfig().apiSecret).update(message).digest("hex");
}

export async function GET(request: Request, ctx: Ctx) {
  if (off()) return new Response("Not found", { status: 404 });
  const [shop, ...rest] = (await ctx.params).path;
  const url = new URL(request.url);
  if (rest.join("/") === "admin/oauth/authorize") {
    // The merchant "approves" instantly; Shopify would show its own consent screen here.
    const back = new URL(url.searchParams.get("redirect_uri")!);
    const params = new URLSearchParams({ code: `mockcode_${Date.now()}`, shop, state: url.searchParams.get("state") ?? "", timestamp: String(Math.floor(Date.now() / 1000)) });
    params.set("hmac", sign(params));
    back.search = params.toString();
    return Response.redirect(back, 302);
  }
  return new Response("Not found", { status: 404 });
}

export async function POST(request: Request, ctx: Ctx) {
  if (off()) return new Response("Not found", { status: 404 });
  const [shop, ...rest] = (await ctx.params).path;
  const route = rest.join("/");

  if (route === "admin/oauth/access_token") return Response.json({ access_token: `shpat_mock_${shop}`, scope: shopifyConfig().scopes });

  if (route === "simulate/order") {
    // Dev tool: pretend a customer checked out with a GhostCart code, and send the signed webhook.
    const { code } = (await request.json()) as { code: string };
    const body = JSON.stringify({ id: Date.now(), name: `#${1000 + Math.floor(Math.random() * 9000)}`, discount_codes: [{ code, amount: "0", type: "fixed_amount" }] });
    const res = await fetch(`${shopifyConfig().appUrl}/api/shopify/webhooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Topic": "orders/create", "X-Shopify-Shop-Domain": shop, "X-Shopify-Hmac-Sha256": createHmac("sha256", shopifyConfig().apiSecret).update(body).digest("base64") },
      body,
    });
    return Response.json({ delivered: res.status });
  }

  if (/^admin\/api\/[^/]+\/graphql\.json$/.test(route)) {
    if (request.headers.get("x-shopify-access-token") !== `shpat_mock_${shop}`) return Response.json({ errors: [{ message: "Invalid API key or access token" }] }, { status: 401 });
    const { query, variables } = (await request.json()) as { query: string; variables: Record<string, unknown> };
    const op = query.match(/(?:query|mutation)\s+(\w+)/)?.[1];
    const ok = { userErrors: [] };
    switch (op) {
      case "GhostCartShop":
        return Response.json({ data: { shop: { name: "ZZ Mock Shopify Store", primaryDomain: { url: `https://${shop}` } }, currentAppInstallation: { id: "gid://shopify/AppInstallation/1" } } });
      case "GhostCartKey":
        await kv.kvSet(`mockshopify:${shop}:metafields`, variables.metafields);
        return Response.json({ data: { metafieldsSet: { metafields: [{ id: "gid://shopify/Metafield/1" }], ...ok } } });
      case "GhostCartHook":
        return Response.json({ data: { webhookSubscriptionCreate: { webhookSubscription: { id: `gid://shopify/WebhookSubscription/${variables.topic}` }, ...ok } } });
      case "GhostCartProducts":
        return Response.json({
          data: {
            products: {
              nodes: PRODUCTS.map((p) => ({ id: p.id, title: p.title, descriptionHtml: `<p>${p.title}</p>`, status: "ACTIVE", featuredMedia: null, variants: { nodes: [{ id: p.variant, price: p.price, compareAtPrice: p.compareAt, inventoryQuantity: p.stock }] } })),
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        });
      case "GhostCartGrant": {
        const input = variables.input as { code: string };
        await kv.kvSet(`mockshopify:${shop}:discount:${input.code}`, input);
        return Response.json({ data: { discountCodeBasicCreate: { codeDiscountNode: { id: `gid://shopify/DiscountCodeNode/${Date.now()}` }, ...ok } } });
      }
      case "GhostCartBilling":
        return Response.json({ data: { appSubscriptionCreate: { confirmationUrl: `https://${shop}/admin/charges/confirm`, appSubscription: { id: "gid://shopify/AppSubscription/1", lineItems: [{ id: "gid://shopify/AppSubscriptionLineItem/1" }] }, ...ok } } });
      case "GhostCartUsage":
        await kv.kvSet(`mockshopify:${shop}:usage:${Date.now()}`, variables);
        return Response.json({ data: { appUsageRecordCreate: { appUsageRecord: { id: "gid://shopify/AppUsageRecord/1" }, ...ok } } });
      default:
        return Response.json({ errors: [{ message: `mock-shopify doesn't know ${op}` }] });
    }
  }
  return new Response("Not found", { status: 404 });
}
