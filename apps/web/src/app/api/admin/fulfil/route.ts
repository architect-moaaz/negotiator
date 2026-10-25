import { isAdmin } from "@/lib/admin";
import { advanceOrder, CheckoutError } from "@/lib/checkout";
import { toPublic } from "@/lib/negotiate";
import { store } from "@/lib/store";

/** Deal desk: move a placed order to its next delivery stage (confirmed → shipped → out for delivery → delivered). */
export async function POST(request: Request) {
  if (!isAdmin(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { id?: string; courier?: string; awb?: string; by?: string };
  const deal = body.id ? await store.getDeal(body.id) : undefined;
  if (!deal) return Response.json({ error: "Deal not found." }, { status: 404 });
  try {
    return Response.json(toPublic(await advanceOrder(deal, { courier: body.courier, awb: body.awb, by: (body.by || "Deal desk").slice(0, 40) })));
  } catch (err) {
    if (err instanceof CheckoutError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
