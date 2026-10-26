import { store as kv } from "@/lib/store";

/** Development stand-in for Gupshup's send API: records messages (GET to read them). Never in production. */
const off = () => process.env.VERCEL_ENV === "production" || !process.env.GUPSHUP_API_BASE?.includes("/api/mock-gupshup");

export async function POST(request: Request) {
  if (off()) return new Response("Not found", { status: 404 });
  if (!request.headers.get("apikey")) return Response.json({ status: "error", message: "Authentication Failed" }, { status: 401 });
  const form = new URLSearchParams(await request.text());
  const sent = (await kv.kvGet<unknown[]>("mockgupshup:sent")) ?? [];
  await kv.kvSet("mockgupshup:sent", [...sent, { source: form.get("source"), destination: form.get("destination"), app: form.get("src.name"), message: JSON.parse(form.get("message") ?? "{}") }].slice(-100), 60 * 60);
  return Response.json({ status: "submitted", messageId: crypto.randomUUID() });
}

export async function GET() {
  if (off()) return new Response("Not found", { status: 404 });
  return Response.json((await kv.kvGet<unknown[]>("mockgupshup:sent")) ?? []);
}
