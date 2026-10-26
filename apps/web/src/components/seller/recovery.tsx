"use client";

import type { RecoveryChannel, RecoverySettings } from "@ghostcart/core";
import { useCallback, useEffect, useState } from "react";
import { inr } from "@/lib/format";
import type { RecoveryStats } from "@/lib/privilege/stats";
import { api, ErrorText, field, primary } from "./ui";

interface RecoveryData {
  settings: RecoverySettings;
  stats: RecoveryStats;
  channels: Record<RecoveryChannel, { ready: boolean; note?: string }>;
}

const DELAYS = [
  [30, "30 minutes"],
  [60, "1 hour"],
  [180, "3 hours"],
  [720, "12 hours"],
  [1440, "1 day"],
] as const;
const CHANNEL_NAMES: Record<RecoveryChannel, string> = { email: "Email", whatsapp: "WhatsApp (from your number)", voice: "Phone call" };

/** "On a ₹5,000 cart your agent goes to ₹4,750 alone and asks you before going lower, never under ₹4,500." */
function Preview({ max, auto }: { max: number; auto: number }) {
  const cart = 5000;
  const floor = Math.round(cart * (1 - max / 100));
  const alone = Math.round(cart * (1 - Math.min(auto, max) / 100));
  return (
    <p className="text-muted">
      On a {inr(cart)} cart your agent goes down to <span className="text-fg">{inr(alone)}</span> on its own and asks you before going lower. It never goes under{" "}
      <span className="text-fg">{inr(floor)}</span>. The discount comes from your margin, and only if the shopper buys.
    </p>
  );
}

function Funnel({ s }: { s: RecoveryStats }) {
  const steps: [string, number | string][] = [
    ["Carts seen", s.captured],
    ["Shoppers who said yes to an offer", s.withConsent],
    ["Abandoned", s.abandoned],
    ["Private offers sent", s.invited],
    ["Offers opened", s.opened],
    ["Recovered", s.recovered],
  ];
  return (
    <section className="rounded-2xl border border-line p-5">
      <h3 className="font-semibold">Last 30 days</h3>
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {steps.map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="text-2xl font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-sm text-muted">
        {s.recovered ? `Recovered carts sold for ${inr(s.recoveredValue)}. ` : "No carts recovered yet. "}
        {s.optedOut ? `${s.optedOut} shopper${s.optedOut === 1 ? "" : "s"} asked to stop offers.` : ""}
      </p>
    </section>
  );
}

/** GhostCart Privilege: turn abandoned carts into one private haggle, paid from the seller's margin. */
export function RecoveryTab({
  storeId,
  platform,
  canManage,
  storeDefaults,
}: {
  storeId: string;
  platform: string;
  canManage: boolean;
  /** The store's normal discount rules, which recovery haggles use until the seller sets their own. */
  storeDefaults: { maxDiscountPct: number; autoApprovePct: number };
}) {
  const [data, setData] = useState<RecoveryData | null>(null);
  const [draft, setDraft] = useState<{ enabled: boolean; max: string; auto: string; delay: number; channels: RecoveryChannel[]; exitPrompt: boolean } | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const r = await api<RecoveryData>(`/api/seller/stores/${storeId}/recovery`);
    if (!r.ok) return setError(r.error);
    setData(r.data);
    const s = r.data.settings;
    setDraft({ enabled: s.enabled, max: String(s.maxDiscountPct ?? storeDefaults.maxDiscountPct), auto: String(s.autoApprovePct ?? storeDefaults.autoApprovePct), delay: s.delayMinutes, channels: s.channels, exitPrompt: s.exitPrompt });
  }, [storeId, storeDefaults.maxDiscountPct, storeDefaults.autoApprovePct]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  if (!data || !draft) return <div className="mt-6">{error ? <ErrorText>{error}</ErrorText> : <p className="text-muted">Loading…</p>}</div>;

  async function save() {
    setError("");
    setSaved(false);
    const r = await api<{ settings: RecoverySettings }>(`/api/seller/stores/${storeId}/recovery`, {
      method: "PUT",
      body: { enabled: draft!.enabled, maxDiscountPct: draft!.max, autoApprovePct: draft!.auto, delayMinutes: draft!.delay, channels: draft!.channels, exitPrompt: draft!.exitPrompt },
    });
    if (!r.ok) return setError(r.error);
    setSaved(true);
    load();
  }
  const set = (patch: Partial<NonNullable<typeof draft>>) => {
    setSaved(false);
    setDraft({ ...draft!, ...patch });
  };
  const where =
    platform === "shopify"
      ? 'Add the "Offer on cart" block to your cart page in the Shopify theme editor.'
      : platform === "woocommerce"
        ? 'The GhostCart plugin adds the button to your cart page. Tick "GhostCart Privilege" in its settings to ask shoppers at checkout.'
        : 'Add <div data-ghostcart-cart="shopify"> or "woocommerce" next to your cart with the widget script.';

  return (
    <div className="mt-6 grid gap-6">
      <section>
        <h2 className="text-xl font-semibold">GhostCart Privilege</h2>
        <p className="mt-2 max-w-2xl text-muted">
          When a shopper leaves without buying, they can make you a private offer on their whole cart. Your agent haggles inside the limits below and asks you before going further.
          Shoppers who agreed at checkout get one invite (email, WhatsApp or a call, 9am to 9pm). Nobody else is contacted.
        </p>
      </section>

      <Funnel s={data.stats} />

      <form
        className="grid max-w-2xl gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="flex items-center gap-3">
          <input type="checkbox" disabled={!canManage} checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="size-5 accent-saffron" />
          <span className="font-semibold">Make private offers on abandoned carts</span>
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="grid gap-1">
            <span className="text-sm text-muted">Most off a whole cart (%)</span>
            <input inputMode="numeric" disabled={!canManage} value={draft.max} onChange={(e) => set({ max: e.target.value })} className={`${field} py-2`} />
          </label>
          <label className="grid gap-1">
            <span className="text-sm text-muted">Agent gives alone, up to (%)</span>
            <input inputMode="numeric" disabled={!canManage} value={draft.auto} onChange={(e) => set({ auto: e.target.value })} className={`${field} py-2`} />
          </label>
        </div>
        <Preview max={Number(draft.max) || 0} auto={Number(draft.auto) || 0} />

        <label className="grid gap-1">
          <span className="text-sm text-muted">Call a cart abandoned after</span>
          <select disabled={!canManage} value={draft.delay} onChange={(e) => set({ delay: Number(e.target.value) })} className={`${field} py-2`}>
            {DELAYS.map(([m, label]) => (
              <option key={m} value={m}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="grid gap-2">
          <legend className="text-sm text-muted">Send the invite by (first one that reaches the shopper)</legend>
          {(["email", "whatsapp", "voice"] as const).map((c) => (
            <label key={c} className="flex items-start gap-3">
              <input
                type="checkbox"
                disabled={!canManage || (!data.channels[c].ready && !draft.channels.includes(c))}
                checked={draft.channels.includes(c)}
                onChange={(e) => set({ channels: e.target.checked ? [...draft.channels, c] : draft.channels.filter((x) => x !== c) })}
                className="mt-1 accent-saffron"
              />
              <span>
                {CHANNEL_NAMES[c]}
                {data.channels[c].note && <span className="block text-sm text-muted">{data.channels[c].note}</span>}
              </span>
            </label>
          ))}
        </fieldset>

        <label className="flex items-start gap-3">
          <input type="checkbox" disabled={!canManage} checked={draft.exitPrompt} onChange={(e) => set({ exitPrompt: e.target.checked })} className="mt-1 accent-saffron" />
          <span>
            Remind shoppers once as they leave the cart page (computers only)
            <span className="block text-sm text-muted">{where}</span>
          </span>
        </label>

        {canManage ? (
          <div className="flex items-center gap-4">
            <button className={primary}>Save</button>
            {saved && <span role="status" className="text-muted">Saved.</span>}
          </div>
        ) : (
          <p className="text-muted">Only the owner or an admin can change these.</p>
        )}
        <ErrorText>{error}</ErrorText>
      </form>
    </div>
  );
}
