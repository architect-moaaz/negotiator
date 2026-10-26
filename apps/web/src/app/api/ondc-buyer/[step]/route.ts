import { confirm, init, initResult, orderState, search, searchResults, select, selectResult, transactionOwner, type Delivery, type Pick } from "@/lib/ondc/buyer";
import { OndcError } from "@/lib/ondc/client";
import { ondcReady } from "@/lib/ondc/config";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/users";

/**
 * The shopper's side of ONDC, step by step (each answer arrives asynchronously, so the page polls GET):
 * search (anyone) → select for a quote → init with delivery details → confirm. Steps after search need
 * a signed-in shopper, and a transaction can only be continued by whoever started it.
 */
const STEPS = new Set(["search", "select", "init", "confirm", "order"]);
const off = () => Response.json({ error: "ONDC isn't switched on." }, { status: 404 });

async function access(transactionId: string | null | undefined, needUser: boolean) {
  const user = await currentUser();
  if (needUser && !user) return { error: Response.json({ error: "Log in to buy." }, { status: 401 }) };
  if (!transactionId) return { error: Response.json({ error: "Search first." }, { status: 400 }) };
  const owner = await transactionOwner(transactionId);
  if (owner === undefined || (owner && owner !== user?.id)) return { error: Response.json({ error: "Search not found." }, { status: 404 }) };
  return { user };
}

export async function GET(request: Request, ctx: RouteContext<"/api/ondc-buyer/[step]">) {
  if (!ondcReady()) return off();
  const { step } = await ctx.params;
  if (!STEPS.has(step) || step === "confirm") return Response.json({ error: "Not found." }, { status: 404 });
  const txn = new URL(request.url).searchParams.get("txn");
  const { error } = await access(txn, step !== "search");
  if (error) return error;
  const result = step === "search" ? { items: await searchResults(txn!) } : step === "select" ? await selectResult(txn!) : step === "init" ? await initResult(txn!) : await orderState(txn!);
  return Response.json(result ?? { waiting: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, ctx: RouteContext<"/api/ondc-buyer/[step]">) {
  if (!ondcReady()) return off();
  const { step } = await ctx.params;
  if (!STEPS.has(step) || step === "order") return Response.json({ error: "Not found." }, { status: 404 });
  const limited = await rateLimit({ name: `ondc:${step}`, id: clientIp(request), max: step === "search" ? 30 : 60, windowSeconds: 10 * 60 });
  if (limited) return limited;
  const body = (await request.json().catch(() => ({}))) as Partial<Pick & { q: string; transactionId: string; delivery: Delivery }>;
  try {
    if (step === "search") {
      const user = await currentUser();
      return Response.json(await search(String(body.q ?? ""), user?.id));
    }
    const { user, error } = await access(body.transactionId, true);
    if (error) return error;
    const pick: Pick = { bppId: String(body.bppId ?? ""), providerId: String(body.providerId ?? ""), itemId: String(body.itemId ?? ""), quantity: Number(body.quantity ?? 1), pincode: String(body.pincode ?? "") };
    if (step === "select") return Response.json(await select(body.transactionId!, pick, user!.id));
    if (step === "init") {
      const d = body.delivery;
      if (!d?.name || !d.phone || !d.building || !d.locality || !d.city || !d.state) return Response.json({ error: "Add the delivery name, phone and full address." }, { status: 400 });
      return Response.json(await init(body.transactionId!, { ...pick, pincode: d.pincode ?? pick.pincode }, d, user!.id));
    }
    return Response.json(await confirm(body.transactionId!, user!.id));
  } catch (err) {
    if (err instanceof OndcError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
