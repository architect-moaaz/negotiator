import { endSession } from "@/lib/session";

export async function POST(request: Request) {
  const { role } = (await request.json().catch(() => ({}))) as { role?: string };
  await endSession(role === "seller" || role === "staff" ? role : "buyer");
  return Response.json({ ok: true });
}
