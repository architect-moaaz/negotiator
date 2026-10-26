import { PrivacyError } from "@/lib/privacy/data";
import { fileGrievance } from "@/lib/privacy/grievances";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/** Public: anyone can write to the grievance officer. Body: { name, contact, category, reference?, message }. */
export async function POST(request: Request) {
  const limited = await rateLimit({ name: "grievance:ip", id: clientIp(request), max: 5, windowSeconds: 60 * 60 });
  if (limited) return limited;
  const body = await request.json().catch(() => ({}));
  try {
    const g = await fileGrievance(body);
    return Response.json({ id: g.id, acknowledgeBy: g.acknowledgeBy, resolveBy: g.resolveBy }, { status: 201 });
  } catch (err) {
    if (err instanceof PrivacyError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
