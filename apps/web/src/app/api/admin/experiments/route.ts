import { EXPERIMENTS, experimentOn, experimentResults, type ExperimentName } from "@/lib/experiments";
import { requireStaff } from "@/lib/staff";

/** Staff: each experiment, whether it's on, and results per variant over the last 30 days. */
export async function GET(request: Request) {
  const { denied } = await requireStaff(request, "view");
  if (denied) return denied;
  const out = [];
  for (const name of Object.keys(EXPERIMENTS) as ExperimentName[]) out.push({ name, on: experimentOn(name), results: await experimentResults(name) });
  return Response.json({ experiments: out }, { headers: { "Cache-Control": "no-store" } });
}
