import { askSupport, cancelOrder, issueState, issueStatusRequest, orderState, raiseIssue, refreshStatus, requestReturn, supportResult, trackOrder, trackResult, transactionOwner } from "@/lib/ondc/buyer";
import { OndcError } from "@/lib/ondc/client";
import { ondcReady } from "@/lib/ondc/config";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { currentUser } from "@/lib/users";

/**
 * After an ONDC order is placed: refresh status, cancel, return, track, seller support, and IGM issues.
 * Only the shopper who placed the order. POST sends the request to the seller app; GET reads its answer
 * (they arrive asynchronously, so the page polls).
 */
async function owner(transactionId: string | null | undefined) {
  if (!ondcReady()) return { error: Response.json({ error: "ONDC isn't switched on." }, { status: 404 }) };
  const user = await currentUser();
  if (!user) return { error: Response.json({ error: "Log in first." }, { status: 401 }) };
  if (!transactionId || (await transactionOwner(transactionId)) !== user.id) return { error: Response.json({ error: "Order not found." }, { status: 404 }) };
  return { user };
}

export async function GET(request: Request, ctx: RouteContext<"/api/ondc-buyer/after/[action]">) {
  const { action } = await ctx.params;
  const txn = new URL(request.url).searchParams.get("txn");
  const { error } = await owner(txn);
  if (error) return error;
  const read = { order: orderState, track: trackResult, support: supportResult, issue: issueState }[action];
  if (!read) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json((await read(txn!)) ?? { waiting: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request, ctx: RouteContext<"/api/ondc-buyer/after/[action]">) {
  const { action } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { transactionId?: string; reason?: string; issueId?: string; type?: string; description?: string; name?: string; phone?: string; email?: string };
  const { user, error } = await owner(body.transactionId);
  if (error) return error;
  const limited = await rateLimit({ name: `ondc-after:${action}`, id: clientIp(request), max: 30, windowSeconds: 10 * 60 });
  if (limited) return limited;
  const txn = body.transactionId!;
  try {
    switch (action) {
      case "status":
        return Response.json(await refreshStatus(txn, user!.id));
      case "cancel":
        return Response.json(await cancelOrder(txn, String(body.reason ?? ""), user!.id));
      case "return":
        return Response.json(await requestReturn(txn, String(body.reason ?? ""), user!.id));
      case "track":
        return Response.json(await trackOrder(txn, user!.id));
      case "support":
        return Response.json(await askSupport(txn, user!.id));
      case "issue":
        return Response.json(await raiseIssue(txn, { type: String(body.type ?? ""), description: String(body.description ?? ""), name: user!.name, phone: user!.phone, email: body.email }, user!.id));
      case "issue_status":
        return Response.json(await issueStatusRequest(txn, String(body.issueId ?? ""), user!.id));
      default:
        return Response.json({ error: "Not found." }, { status: 404 });
    }
  } catch (err) {
    if (err instanceof OndcError) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
