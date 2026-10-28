"use client";

import type { AwayRule } from "@ghostcart/core";
import { useEffect, useState } from "react";
import { api, ErrorText, field, secondary } from "./ui";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hour = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;

/** "When I'm away": during set hours, offers down to a % off are approved without the seller. */
export function AwayRuleForm({ storeId, canManage }: { storeId: string; canManage: boolean }) {
  const [rule, setRule] = useState<AwayRule | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let live = true;
    api<{ away: AwayRule }>(`/api/seller/stores/${storeId}/automation`).then((r) => live && r.ok && setRule(r.data.away));
    return () => {
      live = false;
    };
  }, [storeId]);
  if (!rule) return null;
  const set = (patch: Partial<AwayRule>) => {
    setSaved(false);
    setRule({ ...rule, ...patch });
  };
  return (
    <section className="mt-10 max-w-2xl rounded-2xl border border-line p-5">
      <h3 className="font-semibold">When you&apos;re away</h3>
      <p className="mt-1 text-sm text-muted">
        Offers that would come to you during these hours are approved automatically, down to the discount you set here. Never below your floor. Everything it
        approves shows in your recent deals.
      </p>
      <label className="mt-4 flex items-center gap-3">
        <input type="checkbox" disabled={!canManage} checked={rule.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="size-5 accent-saffron" />
        <span>Approve for me when I&apos;m away</span>
      </label>
      <div className="mt-3 flex flex-wrap items-end gap-4">
        <label className="grid gap-1 text-sm">
          <span className="text-muted">Up to (% off list)</span>
          <input inputMode="decimal" disabled={!canManage} value={String(rule.maxPctOff)} onChange={(e) => set({ maxPctOff: Number(e.target.value) || 0 })} className={`${field} w-24 py-2`} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted">From</span>
          <select disabled={!canManage} value={rule.startHour} onChange={(e) => set({ startHour: Number(e.target.value) })} className={`${field} py-2`}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {hour(h)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted">Until</span>
          <select disabled={!canManage} value={rule.endHour} onChange={(e) => set({ endHour: Number(e.target.value) })} className={`${field} py-2`}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {hour(h)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="mt-3 flex flex-wrap gap-2">
        <legend className="mb-1 text-sm text-muted">Starting on (IST)</legend>
        {DAYS.map((d, i) => (
          <label key={d} className={`rounded-full border px-3 py-1 text-sm ${rule.days.includes(i) ? "border-saffron" : "border-line text-muted"}`}>
            <input
              type="checkbox"
              className="sr-only"
              disabled={!canManage}
              checked={rule.days.includes(i)}
              onChange={(e) => set({ days: e.target.checked ? [...rule.days, i] : rule.days.filter((x) => x !== i) })}
            />
            {d}
          </label>
        ))}
      </fieldset>
      {canManage && (
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={async () => {
              setError("");
              const r = await api<{ away: AwayRule }>(`/api/seller/stores/${storeId}/automation`, { method: "PUT", body: rule });
              if (!r.ok) return setError(r.error);
              setRule(r.data.away);
              setSaved(true);
            }}
            className={secondary}
          >
            Save
          </button>
          {saved && <span role="status" className="text-muted">Saved.</span>}
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </section>
  );
}
