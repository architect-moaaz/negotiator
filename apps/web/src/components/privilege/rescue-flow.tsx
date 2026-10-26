"use client";

import Image from "next/image";
import { useState } from "react";
import { inr } from "@/lib/format";
import type { RescueOffer } from "@/lib/rescue/match";

interface Item {
  title: string;
  brand?: string;
  price?: number;
  quantity: number;
  source?: string;
}
interface Result {
  item: Item;
  offers: RescueOffer[];
}

const readAsBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

/** Paste links or upload a screenshot → GhostCart sellers per item → pick → one offer page per store. */
export function RescueFlow() {
  const [mode, setMode] = useState<"links" | "screenshot">("links");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [picked, setPicked] = useState<Record<number, string | null>>({});
  const [carts, setCarts] = useState<{ storeName: string; items: number; url: string }[] | null>(null);

  async function find() {
    setBusy(true);
    setError("");
    setCarts(null);
    const body = mode === "links" ? { text } : file ? { image: { base64: await readAsBase64(file), mediaType: file.type } } : {};
    const res = await fetch("/api/rescue/find", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error || "Something went wrong. Try again.");
    setResults(data.results);
    // Pre-pick only exact matches; "similar" items are the shopper's call.
    setPicked(Object.fromEntries((data.results as Result[]).map((r, i) => [i, r.offers[0] && r.offers[0].match.kind !== "similar" ? r.offers[0].productId : null])));
  }

  async function makeOffers() {
    if (!results) return;
    const picks = results.flatMap((r, i) => (picked[i] ? [{ productId: picked[i]!, quantity: r.item.quantity }] : []));
    setBusy(true);
    setError("");
    const res = await fetch("/api/rescue/cart", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ picks }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error || "Something went wrong. Try again.");
    if (data.carts.length === 1) window.location.assign(data.carts[0].url);
    else setCarts(data.carts);
  }

  const chosen = Object.values(picked).filter(Boolean).length;

  return (
    <div className="mt-8 grid gap-8">
      <section className="rounded-2xl border border-line p-5">
        <div role="tablist" className="flex gap-6 border-b border-line">
          {(["links", "screenshot"] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`-mb-px border-b-2 pb-3 ${mode === m ? "border-saffron text-fg" : "border-transparent text-muted hover:text-fg"}`}>
              {m === "links" ? "Paste links" : "Upload a screenshot"}
            </button>
          ))}
        </div>
        {mode === "links" ? (
          <label className="mt-4 grid gap-2">
            <span className="text-muted">Product links or names from your cart, one per line</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              placeholder={"https://www.amazon.in/Milton-Thermosteel-Flip-Bottle/dp/…\n2 x Cotton kurta, blue"}
              className="rounded-xl border border-line bg-panel px-4 py-3 text-fg placeholder:text-muted/60 focus:border-saffron focus:outline-none"
            />
          </label>
        ) : (
          <label className="mt-4 grid gap-2">
            <span className="text-muted">A screenshot of your cart (PNG, JPEG or WebP)</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        )}
        <button
          onClick={find}
          disabled={busy || (mode === "links" ? !text.trim() : !file)}
          className="mt-4 rounded-xl bg-saffron px-6 py-3.5 text-lg font-semibold text-paper-ink disabled:opacity-50"
        >
          {busy && !results ? "Looking…" : "Find sellers"}
        </button>
        <p className="mt-3 text-sm text-muted">
          We only use what you give us here: we don&apos;t open your links, sign in to any marketplace, or keep your screenshot.
        </p>
      </section>

      {results && (
        <section className="grid gap-4">
          {results.map((r, i) => (
            <div key={i} className="rounded-2xl border border-line p-5">
              <p className="font-semibold">
                {r.item.quantity > 1 && `${r.item.quantity} × `}
                {r.item.title}
              </p>
              <p className="text-sm text-muted">
                {[r.item.source, r.item.price ? `${inr(r.item.price)} each on your cart` : null].filter(Boolean).join(" · ") || "From your cart"}
              </p>
              {r.offers.length === 0 ? (
                <p className="mt-3 text-muted">No GhostCart seller has this yet.</p>
              ) : (
                <fieldset className="mt-3 grid gap-2">
                  <legend className="sr-only">Pick a seller for {r.item.title}</legend>
                  {r.offers.map((o) => (
                    <label key={o.productId} className={`flex items-center gap-3 rounded-xl border p-3 ${picked[i] === o.productId ? "border-saffron" : "border-line"}`}>
                      <input type="radio" name={`item-${i}`} checked={picked[i] === o.productId} onChange={() => setPicked({ ...picked, [i]: o.productId })} className="accent-saffron" />
                      <div className="size-12 shrink-0 overflow-hidden rounded-lg bg-panel">{o.image && <Image src={o.image} alt="" width={48} height={48} unoptimized className="size-full object-cover" />}</div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{o.title}</p>
                        <p className="text-sm text-muted">
                          {o.storeName} · <span className={o.match.kind === "similar" ? "" : "text-fg"}>{o.match.kind === "similar" ? "Similar item" : o.match.why}</span>
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{inr(o.price)}</p>
                        {r.item.price && o.price < r.item.price && <p className="text-sm text-muted">{inr(r.item.price - o.price)} less before you haggle</p>}
                      </div>
                    </label>
                  ))}
                  <label className="flex items-center gap-3 px-3 text-sm text-muted">
                    <input type="radio" name={`item-${i}`} checked={!picked[i]} onChange={() => setPicked({ ...picked, [i]: null })} className="accent-saffron" />
                    Skip this item
                  </label>
                </fieldset>
              )}
            </div>
          ))}
          <p className="text-sm text-muted">GhostCart sellers are independent shops. A &quot;similar item&quot; may differ from your cart&apos;s listing, so check the details before you buy.</p>
          <button onClick={makeOffers} disabled={busy || !chosen} className="rounded-xl bg-saffron px-6 py-3.5 text-lg font-semibold text-paper-ink disabled:opacity-50">
            {busy ? "Getting your offers ready…" : chosen ? `Make offers on ${chosen} item${chosen === 1 ? "" : "s"}` : "Pick at least one item"}
          </button>
        </section>
      )}

      {carts && (
        <section className="rounded-2xl border border-line p-5">
          <h2 className="font-semibold">Your items are with {carts.length} sellers</h2>
          <p className="mt-1 text-muted">Each seller haggles and ships on their own, so make each one an offer.</p>
          <ul className="mt-4 grid gap-2">
            {carts.map((c) => (
              <li key={c.url}>
                <a href={c.url} className="text-fg underline underline-offset-4">
                  Make {c.storeName} an offer ({c.items} item{c.items === 1 ? "" : "s"})
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      {error && (
        <p role="alert" className="text-alarm">
          {error}
        </p>
      )}
    </div>
  );
}
