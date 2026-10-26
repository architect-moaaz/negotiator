import { store as kv } from "@/lib/store";

/**
 * Development stand-in for Seller Central consent, Login with Amazon and the SP-API Reports calls
 * GhostCart makes. Point AMAZON_CONSENT_BASE / AMAZON_LWA_BASE / AMAZON_SPAPI_BASE at
 * <app>/api/mock-amazon. Never available in production.
 */
const off = () => process.env.VERCEL_ENV === "production" || !process.env.AMAZON_SPAPI_BASE;
type Ctx = { params: Promise<{ path: string[] }> };

const REPORT = [
  ["item-name", "seller-sku", "price", "quantity", "asin1", "status"],
  ["ZZ Amazon Boat Airdopes 141", "ZZ-AMZ-BOAT141", "1299", "25", "B09N3XMZ5F", "Active"],
  ["ZZ Amazon Prestige Kettle 1.5L", "ZZ-AMZ-KETTLE", "899", "8", "B07ZZ00001", "Active"],
  ["ZZ Amazon broken row", "ZZ-AMZ-BAD", "", "3", "B07ZZ00002", "Active"],
]
  .map((r) => r.join("\t"))
  .join("\n");

export async function GET(request: Request, ctx: Ctx) {
  if (off()) return new Response("Not found", { status: 404 });
  const path = (await ctx.params).path.join("/");
  const url = new URL(request.url);
  if (path === "apps/authorize/consent") {
    const back = new URL(url.searchParams.get("redirect_uri")!);
    back.searchParams.set("spapi_oauth_code", `mockcode_${Date.now()}`);
    back.searchParams.set("state", url.searchParams.get("state") ?? "");
    back.searchParams.set("selling_partner_id", "AZZMOCKSELLER1");
    return Response.redirect(back, 302);
  }
  const report = path.match(/^reports\/2021-06-30\/reports\/(.+)$/);
  if (report) {
    // Like Amazon, the report takes a while: in progress on the first poll, done from the second (or once finished by hand).
    const polls = ((await kv.kvGet<number>(`mockamazon:polls:${report[1]}`)) ?? 0) + 1;
    await kv.kvSet(`mockamazon:polls:${report[1]}`, polls);
    return Response.json({ reportId: report[1], processingStatus: polls >= 2 ? "DONE" : "IN_PROGRESS", reportDocumentId: `doc_${report[1]}` });
  }
  const doc = path.match(/^reports\/2021-06-30\/documents\/(.+)$/);
  if (doc) return Response.json({ reportDocumentId: doc[1], url: `${url.origin}/api/mock-amazon/download/${doc[1]}` });
  if (path.startsWith("download/")) return new Response(REPORT, { headers: { "Content-Type": "text/tab-separated-values" } });
  return new Response("Not found", { status: 404 });
}

export async function POST(request: Request, ctx: Ctx) {
  if (off()) return new Response("Not found", { status: 404 });
  const path = (await ctx.params).path.join("/");
  if (path === "auth/o2/token") return Response.json({ access_token: "Atza|mock", refresh_token: "Atzr|mock", expires_in: 3600, token_type: "bearer" });
  if (path === "reports/2021-06-30/reports") {
    const reportId = `mockreport_${Date.now()}`;
    return Response.json({ reportId });
  }
  if (path.startsWith("finish/")) {
    // Dev tool: mark a report as built so the next poll imports it.
    await kv.kvSet(`mockamazon:polls:${path.slice(7)}`, 1); // the next poll reports it done
    return Response.json({ ok: true });
  }
  return new Response("Not found", { status: 404 });
}
