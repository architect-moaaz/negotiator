import { isAdmin } from "@/lib/admin";
import { userInsights } from "@/lib/insights";
import { store } from "@/lib/store";

/** Login and purchase tracking for /userloggedin: who signed in, and who negotiated, locked, bought. */
export async function GET(request: Request) {
  if (!isAdmin(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const [users, deals, activity] = await Promise.all([store.listUsers(), store.listDeals(), store.listLog(20000)]);
  return Response.json(userInsights(users, deals, activity), { headers: { "Cache-Control": "no-store" } });
}
