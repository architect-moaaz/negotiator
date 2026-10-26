import { flipkartConfig } from "@/lib/flipkart/api";

/**
 * Development stand-in for Flipkart's OAuth service and Listings API v3: consent is instant, and the
 * seller "lists" SKUs FK-ZZ-1…FK-ZZ-3 (FK-ZZ-3 inactive). Point FLIPKART_AUTH_BASE and FLIPKART_API_BASE
 * at <app>/api/mock-flipkart/oauth-service and /sellers. Never in production.
 */
const off = () => process.env.VERCEL_ENV === "production" || !flipkartConfig().authBase.includes("/api/mock-flipkart");
type Ctx = { params: Promise<{ path: string[] }> };

const LISTINGS: Record<string, { price: { mrp: number; selling_price: number }; listing_status: string; inventory: number }> = {
  "FK-ZZ-1": { price: { mrp: 1999, selling_price: 1649 }, listing_status: "ACTIVE", inventory: 14 },
  "FK-ZZ-2": { price: { mrp: 899, selling_price: 749 }, listing_status: "ACTIVE", inventory: 40 },
  "FK-ZZ-3": { price: { mrp: 2999, selling_price: 2499 }, listing_status: "INACTIVE", inventory: 0 },
};

export async function GET(request: Request, ctx: Ctx) {
  if (off()) return new Response("Not found", { status: 404 });
  const path = (await ctx.params).path.join("/");
  const url = new URL(request.url);
  if (path === "oauth-service/oauth/authorize") {
    const back = new URL(url.searchParams.get("redirect_uri")!);
    back.searchParams.set("code", `mockfk_${Date.now()}`);
    back.searchParams.set("state", url.searchParams.get("state") ?? "");
    return Response.redirect(back, 302);
  }
  if (path === "oauth-service/oauth/token") {
    const c = flipkartConfig();
    if (request.headers.get("authorization") !== `Basic ${Buffer.from(`${c.appId}:${c.appSecret}`).toString("base64")}`) return Response.json({ error: "invalid_client" }, { status: 401 });
    return Response.json({ access_token: `mockfk_access_${Date.now()}`, refresh_token: "mockfk_refresh", expires_in: 3600, token_type: "bearer" });
  }
  const m = path.match(/^sellers\/listings\/v3\/(.+)$/);
  if (m) {
    if (!request.headers.get("authorization")?.startsWith("Bearer mockfk_access_")) return Response.json({ error: "unauthorized" }, { status: 401 });
    const skus = decodeURIComponent(m[1]).split(",");
    return Response.json({ available: Object.fromEntries(skus.filter((s) => LISTINGS[s]).map((s) => [s, LISTINGS[s]])), invalid: skus.filter((s) => !LISTINGS[s]) });
  }
  return new Response("Not found", { status: 404 });
}
