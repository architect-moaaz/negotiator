"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { inr } from "@/lib/format";

interface Item {
  bppId: string;
  sellerApp: string;
  providerId: string;
  providerName: string;
  itemId: string;
  name: string;
  price: number;
  mrp?: number;
}
interface Quote {
  total: number;
  lines: { title: string; kind: string; amount: number }[];
  deliveryTime?: string;
}
type Step = { kind: "idle" } | { kind: "quoting" } | { kind: "quoted"; quote: Quote } | { kind: "details"; quote: Quote } | { kind: "terms"; quote: Quote; payUrl?: string; payable: boolean } | { kind: "ordered"; state: string; payUrl?: string };

const field = "w-full rounded-xl border border-line bg-panel px-3 py-2.5";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "P2D" → "2 days", "PT4H" → "4 hours" (ONDC durations are ISO 8601). */
function duration(iso?: string) {
  const m = iso?.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?)?/);
  if (!m) return undefined;
  if (m[1]) return `${m[1]} day${m[1] === "1" ? "" : "s"}`;
  if (m[2]) return `${m[2]} hour${m[2] === "1" ? "" : "s"}`;
  return undefined;
}

async function call<T>(path: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, data } : { ok: false, error: data.error ?? "Something went wrong. Try again.", status: res.status };
}

/** Poll an async ONDC step until the seller app answers (or give up after ~15 seconds). */
async function waitFor<T extends object>(path: string): Promise<T | { error: string }> {
  for (let i = 0; i < 15; i++) {
    const r = await call<T & { waiting?: boolean }>(path);
    if (!r.ok) return { error: r.error };
    if (!("waiting" in r.data)) return r.data;
    await sleep(1000);
  }
  return { error: "The seller didn't answer in time. Try again." };
}

/** Sellers on ONDC, the government-backed open network, for the same search. */
export function OndcResults({ query }: { query: string }) {
  const [txn, setTxn] = useState<string | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [pincode, setPincode] = useState("");
  const [qty, setQty] = useState(1);
  const [to, setTo] = useState({ name: "", phone: "", building: "", locality: "", city: "", state: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      const r = await call<{ transactionId: string }>("/api/ondc-buyer/search", { q: query });
      if (!r.ok || !live) return setItems([]);
      setTxn(r.data.transactionId);
      // Sellers answer over a few seconds; show what's arrived as it arrives.
      for (let i = 0; i < 6 && live; i++) {
        await sleep(i ? 1500 : 800);
        const res = await call<{ items: Item[] }>(`/api/ondc-buyer/search?txn=${r.data.transactionId}`);
        if (res.ok && live) setItems(res.data.items);
      }
    })();
    return () => {
      live = false;
    };
  }, [query]);

  const key = (i: Item) => `${i.bppId}/${i.providerId}/${i.itemId}`;
  const chosen = items?.find((i) => key(i) === open);
  const pick = chosen && { transactionId: txn, bppId: chosen.bppId, providerId: chosen.providerId, itemId: chosen.itemId, quantity: qty, pincode };

  async function quote() {
    setError("");
    setStep({ kind: "quoting" });
    const r = await call("/api/ondc-buyer/select", pick);
    if (!r.ok) return setError(r.status === 401 ? "Log in to get a quote." : r.error), setStep({ kind: "idle" });
    const res = await waitFor<{ quote?: Quote; error?: string }>(`/api/ondc-buyer/select?txn=${txn}`);
    if ("error" in res && res.error) return setError(res.error), setStep({ kind: "idle" });
    setStep({ kind: "quoted", quote: (res as { quote: Quote }).quote });
  }

  async function sendDetails(quoteNow: Quote) {
    setError("");
    const r = await call("/api/ondc-buyer/init", { ...pick, delivery: { ...to, pincode } });
    if (!r.ok) return setError(r.error);
    const res = await waitFor<{ quote?: Quote; payable?: boolean; payment?: { uri?: string }; error?: string }>(`/api/ondc-buyer/init?txn=${txn}`);
    if ("error" in res && res.error) return setError(res.error);
    const t = res as { quote?: Quote; payable: boolean; payment: { uri?: string } };
    setStep({ kind: "terms", quote: t.quote ?? quoteNow, payable: t.payable, payUrl: t.payment.uri });
  }

  async function place(payUrl?: string) {
    setError("");
    const r = await call("/api/ondc-buyer/confirm", { transactionId: txn });
    if (!r.ok) return setError(r.error);
    const res = await waitFor<{ state?: string; error?: string }>(`/api/ondc-buyer/order?txn=${txn}`);
    if ("error" in res && res.error) return setError(res.error);
    setStep({ kind: "ordered", state: (res as { state: string }).state, payUrl });
  }

  if (!items?.length) return null;
  return (
    <section className="mt-14" aria-labelledby="ondc-heading">
      <h2 id="ondc-heading" className="text-2xl font-semibold">
        From sellers on ONDC
      </h2>
      <p className="mt-1 max-w-2xl text-muted">The government-backed open network. Fixed prices from each seller; the seller delivers and takes payment.</p>
      <ul className="mt-6 divide-y divide-line">
        {items.map((i) => (
          <li key={key(i)} className="py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <div>
                <p>{i.name}</p>
                <p className="text-sm text-muted">
                  {i.providerName} · via {i.sellerApp}
                </p>
              </div>
              <div className="flex items-baseline gap-4">
                <p className="tabular-nums">
                  {inr(i.price)}
                  {i.mrp && i.mrp > i.price && <s className="ml-2 text-sm text-muted">{inr(i.mrp)}</s>}
                </p>
                <button
                  onClick={() => {
                    setOpen(open === key(i) ? null : key(i));
                    setStep({ kind: "idle" });
                    setError("");
                  }}
                  className="rounded-xl border border-line px-3 py-2 text-sm hover:border-saffron"
                  aria-expanded={open === key(i)}
                >
                  {open === key(i) ? "Close" : "Check delivery"}
                </button>
              </div>
            </div>

            {open === key(i) && (
              <div className="mt-4 rounded-2xl border border-line p-4">
                {(step.kind === "idle" || step.kind === "quoting") && (
                  <form
                    className="flex flex-wrap items-end gap-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      quote();
                    }}
                  >
                    <label className="grid gap-1 text-sm">
                      <span className="text-muted">Delivery pincode</span>
                      <input required inputMode="numeric" maxLength={6} value={pincode} onChange={(e) => setPincode(e.target.value.replace(/\D/g, ""))} className={`${field} w-32`} />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="text-muted">Quantity</span>
                      <input type="number" min={1} max={10} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} className={`${field} w-20`} />
                    </label>
                    <button disabled={step.kind === "quoting"} className="rounded-xl bg-saffron px-4 py-2.5 font-semibold text-paper-ink disabled:opacity-50">
                      {step.kind === "quoting" ? "Asking the seller…" : "Get a quote"}
                    </button>
                  </form>
                )}

                {(step.kind === "quoted" || step.kind === "details" || step.kind === "terms") && (
                  <div className="text-sm">
                    <dl className="grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1">
                      {step.quote.lines.map((l, n) => (
                        <div key={n} className="contents">
                          <dt className="text-muted">{l.title}</dt>
                          <dd className="text-right tabular-nums">{inr(l.amount)}</dd>
                        </div>
                      ))}
                      <dt className="font-semibold">Total</dt>
                      <dd className="text-right font-semibold tabular-nums">{inr(step.quote.total)}</dd>
                    </dl>
                    {duration(step.quote.deliveryTime) && <p className="mt-2 text-muted">Delivered in about {duration(step.quote.deliveryTime)}.</p>}
                  </div>
                )}
                {step.kind === "quoted" && (
                  <button onClick={() => setStep({ kind: "details", quote: step.quote })} className="mt-4 rounded-xl bg-saffron px-4 py-2.5 font-semibold text-paper-ink">
                    Buy from {chosen?.providerName}
                  </button>
                )}
                {step.kind === "details" && (
                  <form
                    className="mt-4 grid gap-3 sm:grid-cols-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      sendDetails(step.quote);
                    }}
                  >
                    {(
                      [
                        ["name", "Name", "name"],
                        ["phone", "Phone", "tel"],
                        ["building", "House, building", "address-line1"],
                        ["locality", "Area, street", "address-line2"],
                        ["city", "City", "address-level2"],
                        ["state", "State", "address-level1"],
                      ] as const
                    ).map(([k, label, auto]) => (
                      <label key={k} className="grid gap-1 text-sm">
                        <span className="text-muted">{label}</span>
                        <input required autoComplete={auto} value={to[k]} onChange={(e) => setTo({ ...to, [k]: e.target.value })} className={field} />
                      </label>
                    ))}
                    <p className="text-sm text-muted sm:col-span-2">Delivering to pincode {pincode}. Your name, phone and address go to the seller to deliver the order.</p>
                    <button className="justify-self-start rounded-xl bg-saffron px-4 py-2.5 font-semibold text-paper-ink">Continue</button>
                  </form>
                )}
                {step.kind === "terms" &&
                  (step.payable ? (
                    <div className="mt-4">
                      <p className="text-sm text-muted">The seller takes payment on their own page after you place the order.</p>
                      <button onClick={() => place(step.payUrl)} className="mt-3 rounded-xl bg-saffron px-4 py-2.5 font-semibold text-paper-ink">
                        Place order
                      </button>
                    </div>
                  ) : (
                    <p className="mt-4 text-sm">This seller only takes payment through the buyer app, which GhostCart doesn&apos;t offer on ONDC yet.</p>
                  ))}
                {step.kind === "ordered" && (
                  <div role="status" className="text-sm">
                    <p className="font-semibold">Order placed with {chosen?.providerName}</p>
                    <p className="mt-1 text-muted">Seller status: {step.state || "received"}.</p>
                    {step.payUrl && (
                      <a href={step.payUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block rounded-xl bg-saffron px-4 py-2.5 font-semibold text-paper-ink">
                        Pay the seller
                      </a>
                    )}
                  </div>
                )}
                {error && (
                  <p role="alert" className="mt-3 text-sm text-alarm">
                    {error}{" "}
                    {error.startsWith("Log in") && (
                      <Link href="/login" className="underline underline-offset-4">
                        Log in
                      </Link>
                    )}
                  </p>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
