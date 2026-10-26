import { consentHistory, currentConsents, DEAL_CONTACT_WORDING, recordConsent } from "@/lib/privacy/consent";
import { store } from "@/lib/store";
import { currentUser } from "@/lib/users";

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in first." }, { status: 401 });
  const [state, history] = await Promise.all([currentConsents(user.id), consentHistory(user.id)]);
  return Response.json(
    { dealContact: state.deal_contact ?? (user.consentAt ? "granted" : "withdrawn"), history: history.map((c) => ({ purpose: c.purpose, action: c.action, wording: c.wording, source: c.source, at: c.createdAt })) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Body: { dealContact: boolean }. Withdrawing stops calls and messages about deals; it doesn't cancel orders. */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Log in first." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { dealContact?: unknown };
  if (typeof body.dealContact !== "boolean") return Response.json({ error: "Say whether we may contact you." }, { status: 400 });
  await recordConsent(user.id, "deal_contact", body.dealContact ? "granted" : "withdrawn", body.dealContact ? DEAL_CONTACT_WORDING : "Withdrew consent to deal contact", "account_page");
  await store.updateUser({ ...user, consentAt: body.dealContact ? Date.now() : undefined });
  return Response.json({ dealContact: body.dealContact ? "granted" : "withdrawn" });
}
