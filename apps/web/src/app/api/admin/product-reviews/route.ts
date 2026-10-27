import { OrderError } from "@/lib/orders/service";
import { setReviewHidden } from "@/lib/reviews";
import { requireStaff } from "@/lib/staff";

/** Staff moderation: hide (or restore) an abusive review. Body: { id, hidden, reason }. Never edits ratings. */
export async function POST(request: Request) {
  const { staff, denied } = await requireStaff(request, "review");
  if (denied) return denied;
  const { id, hidden, reason } = (await request.json().catch(() => ({}))) as { id?: string; hidden?: boolean; reason?: string };
  try {
    const r = await setReviewHidden(String(id ?? ""), hidden !== false, String(reason ?? ""), staff.name);
    return r ? Response.json({ ok: true }) : Response.json({ error: "Review not found." }, { status: 404 });
  } catch (err) {
    if (err instanceof OrderError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
