import { assignSupport, SAVED_REPLIES, supportQueue } from "@/lib/support";
import { requireStaff } from "@/lib/staff";

/** Staff support inbox: complaints and disputes with due times, plus saved replies. */
export async function GET(request: Request) {
  const { denied } = await requireStaff(request, "view");
  if (denied) return denied;
  return Response.json({ items: await supportQueue(), replies: SAVED_REPLIES }, { headers: { "Cache-Control": "no-store" } });
}

/** Take (or release) an item. Body: { kind, id, release? }. */
export async function POST(request: Request) {
  const { staff, denied } = await requireStaff(request, "review");
  if (denied) return denied;
  const { kind, id, release } = (await request.json().catch(() => ({}))) as { kind?: string; id?: string; release?: boolean };
  if ((kind !== "grievance" && kind !== "dispute") || typeof id !== "string") return Response.json({ error: "Pick an item." }, { status: 400 });
  await assignSupport(kind, id, release ? null : staff.name);
  return Response.json({ ok: true });
}
