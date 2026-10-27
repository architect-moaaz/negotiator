import type { RecoveryChannel } from "@ghostcart/core";
import { emailConfigured } from "@/lib/email";
import { storeWhatsApp } from "@/lib/meta/whatsapp";
import { getRecovery, RecoveryError, setRecovery } from "@/lib/privilege/settings";
import { recoveryStats } from "@/lib/privilege/stats";
import { logSellerAction, requireStoreAccess } from "@/lib/shop/access";
import { vobizConfigured } from "@/lib/vobiz";

/** Which invite channels can actually send for this store right now, and why not. */
async function channelStatus(storeId: string): Promise<Record<RecoveryChannel, { ready: boolean; note?: string }>> {
  const wa = await storeWhatsApp(storeId);
  const template = (typeof wa?.meta.privilegeTemplate === "string" && wa.meta.privilegeTemplate) || process.env.WHATSAPP_PRIVILEGE_TEMPLATE;
  return {
    email: emailConfigured() ? { ready: true } : { ready: false, note: "Email isn't set up on GhostCart yet." },
    whatsapp: !wa ? { ready: false, note: "Connect your WhatsApp number under Integrations." } : !template ? { ready: false, note: "Your private-offer template isn't approved yet." } : { ready: true },
    voice:
      process.env.PRIVILEGE_VOICE_CALLS === "1" && vobizConfigured
        ? { ready: true, note: "Only offers the link (press 1) or stop (press 9)." }
        : { ready: false, note: "Invite calls are coming soon." },
  };
}

/** GhostCart Privilege settings, the store's recovery funnel (last 30 days) and channel readiness. */
export async function GET(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/recovery">) {
  const { store, denied } = await requireStoreAccess(request, (await ctx.params).id, "view");
  if (denied) return denied;
  const [settings, stats, channels] = await Promise.all([getRecovery(store.id), recoveryStats(store.id), channelStatus(store.id)]);
  return Response.json({ settings, stats, channels });
}

/** Save recovery settings. Body: any of { enabled, maxDiscountPct, autoApprovePct, delayMinutes, channels, exitPrompt }. */
export async function PUT(request: Request, ctx: RouteContext<"/api/seller/stores/[id]/recovery">) {
  const { store, phone, denied } = await requireStoreAccess(request, (await ctx.params).id, "manage");
  if (denied) return denied;
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const pct = (v: unknown) => (v === undefined ? undefined : v === null || v === "" ? null : Number(v));
  const input = {
    ...(typeof b.enabled === "boolean" ? { enabled: b.enabled } : {}),
    ...(b.maxDiscountPct !== undefined ? { maxDiscountPct: pct(b.maxDiscountPct) ?? undefined } : {}),
    ...(b.autoApprovePct !== undefined ? { autoApprovePct: pct(b.autoApprovePct) ?? undefined } : {}),
    ...(b.delayMinutes !== undefined ? { delayMinutes: Number(b.delayMinutes) } : {}),
    ...(Array.isArray(b.channels) ? { channels: b.channels.map(String) as RecoveryChannel[] } : {}),
    ...(typeof b.exitPrompt === "boolean" ? { exitPrompt: b.exitPrompt } : {}),
  };
  try {
    const settings = await setRecovery(store.id, input);
    await logSellerAction(store, phone, `set cart recovery: ${JSON.stringify(settings)}`);
    return Response.json({ settings });
  } catch (err) {
    if (err instanceof RecoveryError) return Response.json({ error: err.message, errors: err.errors }, { status: 400 });
    throw err;
  }
}
