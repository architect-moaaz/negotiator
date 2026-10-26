import { store as kv } from "@/lib/store";

/**
 * Development stand-in for Expo's push service: records what would have been sent (GET to read).
 * Tokens containing "dead" answer DeviceNotRegistered. Point EXPO_PUSH_URL here. Never in production.
 */
const off = () => process.env.VERCEL_ENV === "production" || !process.env.EXPO_PUSH_URL?.includes("/api/mock-expo-push");

export async function POST(request: Request) {
  if (off()) return new Response("Not found", { status: 404 });
  const messages = (await request.json()) as { to: string }[];
  const sent = (await kv.kvGet<unknown[]>("mockpush:sent")) ?? [];
  await kv.kvSet("mockpush:sent", [...sent, ...messages].slice(-100), 60 * 60);
  return Response.json({ data: messages.map((m) => (m.to.includes("dead") ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok", id: crypto.randomUUID() })) });
}

export async function GET() {
  if (off()) return new Response("Not found", { status: 404 });
  return Response.json((await kv.kvGet<unknown[]>("mockpush:sent")) ?? []);
}
