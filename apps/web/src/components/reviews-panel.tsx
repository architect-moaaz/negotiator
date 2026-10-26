"use client";

import { useCallback, useEffect, useState } from "react";

interface Review {
  store: { id: string; name: string; slug: string; platform: string; domain: string | null };
  org: { name?: string; legalName?: string | null; businessType?: string | null };
  steps: Record<string, string>;
  suggestedTier: "new" | "verified";
  checks: { type: string; status: string; provider: string; masked: string | null; details: Record<string, unknown> }[];
  flags: string[];
}

const TONE: Record<string, string> = { passed: "text-paid", failed: "text-alarm", manual_review: "text-saffron", pending: "text-muted" };

/** Staff review queue: approve a store to go live at a tier, or send it back with a note. */
export function ReviewsPanel() {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [tiers, setTiers] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/reviews", { cache: "no-store" });
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Couldn't load reviews.");
    setReviews(await res.json());
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function decide(r: Review, approve: boolean) {
    setError("");
    const res = await fetch("/api/admin/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId: r.store.id, approve, tier: tiers[r.store.id] ?? r.suggestedTier, note: notes[r.store.id] ?? "" }),
    });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Couldn't save the decision.");
    load();
  }

  if (error && !reviews) return <p className="mt-6 text-alarm">{error}</p>;
  if (!reviews) return <p className="mt-6 text-muted">Loading reviews…</p>;
  return (
    <div className="mt-6 space-y-4">
      {error && <p className="text-alarm">{error}</p>}
      {reviews.length === 0 && <p className="py-6 text-muted">No stores waiting for review.</p>}
      {reviews.map((r) => (
        <article key={r.store.id} className="rounded-2xl border border-line p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-lg font-semibold">{r.store.name}</p>
            <a href={`/s/${r.store.slug}`} className="text-sm text-muted underline underline-offset-4">
              {r.store.platform}
              {r.store.domain ? ` · ${r.store.domain}` : ""}
            </a>
          </div>
          <p className="text-muted">
            {r.org.legalName ?? r.org.name} · {r.org.businessType ?? "type not given"}
          </p>
          {r.flags.length > 0 && (
            <ul className="mt-3 list-disc pl-5 text-alarm">
              {r.flags.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
          <table className="mt-4 w-full text-left text-sm">
            <tbody>
              {r.checks.map((c, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-2 pr-3">{c.type}</td>
                  <td className={`py-2 pr-3 ${TONE[c.status] ?? ""}`}>{c.status.replace("_", " ")}</td>
                  <td className="py-2 pr-3 font-receipt">{c.masked}</td>
                  <td className="py-2 text-muted">
                    {typeof c.details.url === "string" ? (
                      <a href={c.details.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                        View photo
                      </a>
                    ) : c.details.nameOnRecord ? (
                      `On record: ${String(c.details.nameOnRecord)}`
                    ) : (
                      String(c.details.reason ?? "")
                    )}
                    <span className="ml-2">({c.provider})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-sm">
              <span className="text-muted">Tier</span>
              <select value={tiers[r.store.id] ?? r.suggestedTier} onChange={(e) => setTiers({ ...tiers, [r.store.id]: e.target.value })} className="rounded-lg border border-line bg-panel px-3 py-2">
                <option value="new">New (orders up to ₹10,000, 7-day hold)</option>
                <option value="verified">Verified (up to ₹1,00,000, 3-day hold)</option>
              </select>
            </label>
            <button onClick={() => decide(r, true)} className="rounded-xl bg-paid px-4 py-2.5 font-semibold text-ink">
              Approve and go live
            </button>
            <input
              placeholder="What should the seller fix?"
              value={notes[r.store.id] ?? ""}
              onChange={(e) => setNotes({ ...notes, [r.store.id]: e.target.value })}
              className="min-w-64 flex-1 rounded-xl border border-line bg-panel px-4 py-2.5"
            />
            <button onClick={() => decide(r, false)} className="rounded-xl border border-line px-4 py-2.5 hover:border-alarm">
              Send back
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
