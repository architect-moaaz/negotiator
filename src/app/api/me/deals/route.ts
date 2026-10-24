import { toPublic } from "@/lib/negotiate";
import { store } from "@/lib/store";
import { currentUser } from "@/lib/users";

/** The signed-in shopper's negotiations, newest first. */
export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in to see your deals." }, { status: 401 });
  const deals = (await store.listDeals(1000)).filter((d) => d.userId === user.id);
  return Response.json({ name: user.name, deals: deals.map(toPublic) }, { headers: { "Cache-Control": "no-store" } });
}
