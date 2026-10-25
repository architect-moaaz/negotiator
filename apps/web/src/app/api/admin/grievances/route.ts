import { PrivacyError } from "@/lib/privacy/data";
import { acknowledgeGrievance, grievanceDue, openGrievances, resolveGrievance } from "@/lib/privacy/grievances";
import { audit, requireStaff } from "@/lib/staff";

/** Complaints carry names and contact details, so the queue needs PII access. */
export async function GET(request: Request) {
  const { denied } = await requireStaff(request, "pii");
  if (denied) return denied;
  const rows = await openGrievances();
  return Response.json(
    rows.map((g) => ({ ...g, due: grievanceDue(g) })),
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Body: { id, action: "acknowledge" } or { id, action: "resolve", response }. */
export async function POST(request: Request) {
  const { staff, denied } = await requireStaff(request, "pii");
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { id?: string; action?: string; response?: string };
  if (!body.id || (body.action !== "acknowledge" && body.action !== "resolve")) return Response.json({ error: "Pick a complaint and an action." }, { status: 400 });
  try {
    const row = body.action === "acknowledge" ? await acknowledgeGrievance(body.id, staff.name) : await resolveGrievance(body.id, body.response ?? "", staff.name);
    await audit(staff, `${body.action}d grievance ${body.id}`);
    return Response.json(row);
  } catch (err) {
    if (err instanceof PrivacyError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
