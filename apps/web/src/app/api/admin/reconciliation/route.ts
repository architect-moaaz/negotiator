import { reconcileDay, reconciliationStatus, resolveIssue } from "@/lib/orders/reconcile";
import { audit, requireStaff } from "@/lib/staff";

/** Recent reconciliation runs and open differences. */
export async function GET(request: Request) {
  const { denied } = await requireStaff(request, "finance");
  if (denied) return denied;
  return Response.json(await reconciliationStatus(), { headers: { "Cache-Control": "no-store" } });
}

/** Body: { action: "run", day: "YYYY-MM-DD" } or { action: "resolve", id, note }. */
export async function POST(request: Request) {
  const { staff, denied } = await requireStaff(request, "finance");
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { action?: string; day?: string; id?: number; note?: string };
  try {
    if (body.action === "run") {
      const out = await reconcileDay(String(body.day ?? ""));
      if (!out) return Response.json({ error: "No settlement gateway on this deployment." }, { status: 503 });
      await audit(staff, `ran reconciliation for ${body.day}: ${out.run.matched} matched, ${out.run.issues} issues`);
      return Response.json(out.run);
    }
    if (body.action === "resolve") {
      const row = await resolveIssue(Number(body.id), String(body.note ?? ""), staff.name);
      await audit(staff, `resolved reconciliation issue ${row.id} (${row.orderId} ${row.kind}): ${row.note}`);
      return Response.json(row);
    }
    return Response.json({ error: "Run a day or resolve an issue." }, { status: 400 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
