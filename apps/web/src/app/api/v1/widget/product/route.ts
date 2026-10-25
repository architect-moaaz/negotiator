import { policyForProduct } from "@/lib/shop/policies";
import { getProductByRef } from "@/lib/shop/products";
import { storeForKey } from "@/lib/integrations/keys";

/** CORS for the widget: only the store's allowed origins get an answer they can read. */
function cors(origin: string | null): Record<string, string> {
  return origin ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" } : {};
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: cors(request.headers.get("origin")) });
}

/** Widget lookup: can this product be haggled on, and where does the button go? ?key=gc_pk_…&ref=<sku or product id> */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const found = await storeForKey(url.searchParams.get("key"), "publishable", origin);
  if (!found) return Response.json({ error: "This key doesn't work on this site." }, { status: 403 });
  const headers = { ...cors(origin), "Cache-Control": "no-store" };
  const ref = url.searchParams.get("ref") ?? "";
  const product = await getProductByRef(found.store.id, ref);
  if (!product || product.status !== "active" || found.store.status !== "live") return Response.json({ available: false }, { headers });
  const policy = await policyForProduct(product);
  return Response.json(
    {
      available: product.stock > 0,
      haggle: policy.enabled && (!policy.channels?.length || policy.channels.includes("widget")),
      price: product.price,
      url: `${url.origin}/w/${url.searchParams.get("key")}/${encodeURIComponent(ref)}`,
    },
    { headers },
  );
}
