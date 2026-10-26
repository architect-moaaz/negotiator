import type { SellerTier } from "@ghostcart/core";
import { audit, requireStaff } from "@/lib/staff";
import { decideReview, pendingReviews, VerificationError } from "@/lib/verification/service";

/** Stores waiting for review, with their evidence (masked) and any reused-identity or name-mismatch flags. */
export async function GET(request: Request) {
  const { denied } = await requireStaff(request, "review");
  if (denied) return denied;
  const reviews = await pendingReviews();
  return Response.json(
    reviews.map((r) => ({
      store: { id: r.store.id, name: r.store.name, slug: r.store.slug, platform: r.store.platform, domain: r.store.domain, createdAt: r.store.createdAt },
      org: { name: r.org?.name, legalName: r.org?.legalName, businessType: r.org?.businessType },
      steps: r.steps,
      suggestedTier: r.allAutomated && !r.flags.length ? "verified" : "new",
      checks: r.checks.map((c) => ({ type: c.type, status: c.status, provider: c.provider, masked: c.masked, details: { ...c.details } })),
      flags: r.flags.map((c) => (c.details.duplicateOf ? `${c.type.toUpperCase()} is already used by another seller (${c.details.duplicateOf})` : `${c.type.toUpperCase()} name doesn't match: "${c.details.nameOnRecord}"`)),
    })),
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Body: { storeId, approve: true, tier } or { storeId, approve: false, note }. */
export async function POST(request: Request) {
  const { staff, denied } = await requireStaff(request, "review");
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { storeId?: string; approve?: boolean; tier?: SellerTier; note?: string };
  if (!body.storeId) return Response.json({ error: "Pick a store." }, { status: 400 });
  try {
    const store = await decideReview(body.storeId, body.approve ? { approve: true, tier: body.tier ?? "new" } : { approve: false, note: body.note ?? "" }, staff.name);
    await audit(staff, body.approve ? `approved store ${store?.name} (${body.storeId}) as ${body.tier ?? "new"}` : `sent store ${store?.name} (${body.storeId}) back: ${body.note}`);
    return Response.json({ store: { id: store?.id, status: store?.status, tier: store?.tier } });
  } catch (err) {
    if (err instanceof VerificationError) return Response.json({ error: err.message }, { status: 409 });
    throw err;
  }
}
