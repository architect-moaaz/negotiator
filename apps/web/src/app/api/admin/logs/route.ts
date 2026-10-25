import { toPublic } from "@/lib/negotiate";
import { requireStaff } from "@/lib/staff";
import { store } from "@/lib/store";

/** Proof-of-life data for the admin page: signups, agent/payment activity and deals. Contains phone numbers and addresses. */
export async function GET(request: Request) {
  const { staff, denied } = await requireStaff(request, "pii");
  if (denied) return denied;
  const [users, activity, deals, stats, sellers, demand] = await Promise.all([
    store.listUsers(),
    store.listLog(5000),
    store.listDeals(),
    store.stats(),
    store.listSellers(),
    store.topDemand(),
  ]);
  const registered = new Set(sellers.flatMap((s) => s.aliases));
  return Response.json(
    {
      me: { name: staff.name, role: staff.role },
      stats,
      users,
      sellers,
      demand: demand.map((d) => ({ ...d, registered: registered.has(d.key) })),
      activity,
      deals: deals.map((d) => ({ ...toPublic(d), userId: d.userId, pinelabsOrderId: d.pinelabsOrderId, address: d.checkout?.address, terms: d.negotiation?.terms, recommendation: d.negotiation?.recommendation })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
