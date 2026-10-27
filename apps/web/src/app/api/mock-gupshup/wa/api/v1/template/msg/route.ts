import { store as kv } from "@/lib/store";

/** Development stand-in for Gupshup's template send API: records messages alongside text sends. Never in production. */
const off = () => process.env.VERCEL_ENV === "production" || !process.env.GUPSHUP_API_BASE?.includes("/api/mock-gupshup");

export async function POST(request: Request) {
  if (off()) return new Response("Not found", { status: 404 });
  if (!request.headers.get("apikey")) return Response.json({ status: "error", message: "Authentication Failed" }, { status: 401 });
  const form = new URLSearchParams(await request.text());
  const sent = (await kv.kvGet<unknown[]>("mockgupshup:sent")) ?? [];
  await kv.kvSet("mockgupshup:sent", [...sent, { source: form.get("source"), destination: form.get("destination"), app: form.get("src.name"), template: JSON.parse(form.get("template") ?? "{}") }].slice(-100), 60 * 60);
  return Response.json({ status: "submitted", messageId: crypto.randomUUID() });
}
