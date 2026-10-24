"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DEMO_URL, inr } from "@/lib/format";
import type { ListingSeller, NegotiationEvent, Offer, Product, SellerQuote } from "@/lib/types";

type Phase = "idle" | "running" | "done" | "error";

/** Downscale screenshots client-side so uploads stay small and fast. */
async function readImage(file: File): Promise<{ imageBase64: string; mediaType: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { imageBase64: dataUrl.split(",")[1], mediaType: "image/jpeg" };
}

function firstTouch(): { referrer?: string; source?: string } {
  try {
    return JSON.parse(sessionStorage.getItem("gc_src") ?? "{}");
  } catch {
    return {};
  }
}

export function Negotiator() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const slipRef = useRef<HTMLElement>(null);
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [steps, setSteps] = useState<string[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [quotes, setQuotes] = useState<SellerQuote[] | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [listingSeller, setListingSeller] = useState<{ soldBy: ListingSeller; onGhostCart: boolean } | null>(null);
  const [haggle, setHaggle] = useState("");
  const [error, setError] = useState("");
  // undefined = still checking, null = needs to sign up
  const [user, setUser] = useState<{ name: string } | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  // Ask for the link first; contact details only once they've committed to checking an item.
  const [wantsDetails, setWantsDetails] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);

  // First touch: remember where this visitor came from (referrer, ?ref= or utm_source) for analytics.
  useEffect(() => {
    try {
      if (!sessionStorage.getItem("gc_src")) {
        const q = new URLSearchParams(location.search);
        sessionStorage.setItem("gc_src", JSON.stringify({ referrer: document.referrer || undefined, source: q.get("ref") || q.get("utm_source") || undefined }));
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then((r) => r.json())
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  /** Sign up first if needed; returns false (with an error shown) when signup fails. */
  async function ensureUser() {
    if (user) return true;
    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone, consent, ...firstTouch() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNeedsLogin(!!data.needsLogin);
      setPhase("error");
      setError(data.error || "Couldn't sign you up. Try again.");
      return false;
    }
    setUser(data);
    return true;
  }

  async function negotiate(body: Record<string, string>) {
    if (!(await ensureUser())) return;
    setPhase("running");
    setSteps([]);
    setProduct(null);
    setQuotes(null);
    setOffer(null);
    setListingSeller(null);
    setHaggle("");
    setError("");

    try {
      const res = await fetch("/api/negotiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) {
        const { error, needsSignup } = await res.json().catch(() => ({ error: "" }));
        if (needsSignup) setUser(null);
        throw new Error(error || "Negotiation failed. Try again.");
      }

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line) as NegotiationEvent;
          switch (event.type) {
            case "step":
              setSteps((s) => [...s, event.text]);
              break;
            case "product":
              setProduct(event.product);
              break;
            case "seller":
              setListingSeller({ soldBy: event.soldBy, onGhostCart: event.onGhostCart });
              break;
            case "quotes":
              setQuotes(event.quotes);
              break;
            case "haggle":
              setHaggle((h) => h + event.text);
              break;
            case "offer":
              setOffer(event.offer);
              break;
            case "deal":
              setPhase("done");
              setTimeout(() => router.push(`/deal/${event.deal.id}`), 900);
              return;
            case "error":
              throw new Error(event.message);
          }
        }
      }
      throw new Error("The connection dropped before the deal was ready. Try again.");
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Negotiation failed. Try again.");
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (user === null && (!name.trim() || !phone.trim() || !consent)) {
      setPhase("error");
      setError(consent ? "Add your name and mobile number first." : "Add your name and mobile number, and tick the box to agree to be contacted.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setPhase("error");
      setError("Upload an image of your cart, wishlist or product page.");
      return;
    }
    negotiate(await readImage(file));
  }

  const busy = phase === "running" || phase === "done";
  const askDetails = user === null && (url.trim().length > 0 || wantsDetails);
  const submitButton = (
    <button
      type="submit"
      disabled={busy || !url.trim()}
      className="rounded-xl bg-saffron px-6 py-4 text-lg font-semibold text-paper-ink transition-transform active:scale-[0.98] disabled:opacity-50"
    >
      {busy ? "Negotiating…" : user === null && !askDetails ? "Check prices free" : "Find my deal"}
    </button>
  );

  // On phones the slip renders below the form; scroll it into view when the first step prints.
  const hasSteps = steps.length > 0;
  useEffect(() => {
    if (hasSteps) slipRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [hasSteps]);
  const haggleLines = haggle.split("\n").filter((l) => l.trim());

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) negotiate({ url: url.trim() });
        }}
      >
        {user && (
          <p className="text-muted">
            Hi {user.name.split(" ")[0]}, what are you buying today?{" "}
            <button
              type="button"
              disabled={busy}
              onClick={() => fetch("/api/me", { method: "DELETE" }).then(() => setUser(null))}
              className="text-sm underline underline-offset-4 hover:text-fg disabled:opacity-50"
            >
              Log out
            </button>
          </p>
        )}
        <label htmlFor="product-url" className="text-muted">
          Product link from Amazon, Flipkart, Myntra, Croma, Swiggy or anywhere else
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="product-url"
            type="url"
            inputMode="url"
            required
            placeholder="https://www.amazon.in/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy}
            className="min-w-0 flex-1 rounded-xl border border-line bg-panel px-4 py-4 text-lg text-fg placeholder:text-muted/60 focus:border-saffron focus:outline-none disabled:opacity-60"
          />
          {!askDetails && submitButton}
        </div>
        {!url && !busy && (
          <button type="button" onClick={() => setUrl(DEMO_URL)} className="self-start text-sm text-muted underline underline-offset-4 hover:text-fg">
            No link handy? Try a demo item
          </button>
        )}
        {askDetails && (
          <div className="mt-2 grid grid-cols-1 gap-3 rounded-2xl border border-line p-4 sm:grid-cols-2">
            <p className="font-semibold sm:col-span-2">Last step: where can we reach you about this deal?</p>
            <p className="-mt-2 text-sm text-muted sm:col-span-2">
              Been here before?{" "}
              <Link href="/login" className="text-fg underline underline-offset-4">
                Log in with a code
              </Link>
            </p>
            <div className="flex flex-col gap-2">
              <label htmlFor="signup-name" className="text-muted">
                Your name
              </label>
              <input
                id="signup-name"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
                className="rounded-xl border border-line bg-panel px-4 py-3 text-fg focus:border-saffron focus:outline-none disabled:opacity-60"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="signup-phone" className="text-muted">
                Mobile number
              </label>
              <input
                id="signup-phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                required
                placeholder="98765 43210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={busy}
                className="rounded-xl border border-line bg-panel px-4 py-3 text-fg placeholder:text-muted/60 focus:border-saffron focus:outline-none disabled:opacity-60"
              />
            </div>
            <label htmlFor="signup-consent" className="flex items-start gap-3 text-sm text-muted sm:col-span-2">
              <input
                id="signup-consent"
                type="checkbox"
                required
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                disabled={busy}
                className="mt-0.5 size-4 shrink-0 accent-saffron"
              />
              <span>GhostCart can contact me on this number about this deal (calls or messages). We don&apos;t send marketing.</span>
            </label>
          </div>
        )}
        {askDetails && submitButton}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!busy) onFile(e.dataTransfer.files[0]);
          }}
          className="text-muted"
        >
          or{" "}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (user === null && (!name.trim() || !phone.trim() || !consent)) {
                setWantsDetails(true);
                setPhase("error");
                setError("First, tell us where to reach you about this deal, then upload your screenshot.");
                return;
              }
              fileRef.current?.click();
            }}
            className="text-fg underline decoration-line decoration-2 underline-offset-4 hover:decoration-saffron disabled:opacity-50"
          >
            upload a cart screenshot
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
        {phase === "idle" && <p className="text-sm text-muted">Free · about 30 seconds · no payment until you agree on a price</p>}
        {phase === "error" && (
          <p role="alert" className="mt-2 text-alarm">
            {error}
            {needsLogin && (
              <>
                {" "}
                <Link href="/login" className="text-fg underline underline-offset-4">
                  Log in with a code
                </Link>
              </>
            )}
          </p>
        )}
      </form>

      {phase !== "idle" && phase !== "error" && (
        <section ref={slipRef} aria-live="polite" className="receipt px-6 py-8 text-[13px] leading-relaxed shadow-2xl shadow-black/40">
          <p className="text-center font-semibold tracking-wide">GHOSTCART NEGOTIATION SLIP</p>
          <p className="text-center text-paper-muted">{new Date().toLocaleString("en-IN")}</p>
          <div className="receipt-rule my-4" />

          <ul className="space-y-1">
            {steps.map((s, i) => (
              <li key={s} className="print-line flex justify-between gap-4">
                <span>{s}</span>
                <span className="text-paper-muted">{i < steps.length - 1 || phase === "done" ? "ok" : "…"}</span>
              </li>
            ))}
          </ul>

          {product && (
            <>
              <div className="receipt-rule my-4" />
              <div className="print-line">
                <p className="font-semibold">{product.title}</p>
                <div className="flex justify-between">
                  <span>{product.seller}</span>
                  <span>{inr(product.price)}</span>
                </div>
                {listingSeller && (
                  <p className="print-line text-paper-muted">
                    Sold by {listingSeller.soldBy.name}
                    {listingSeller.soldBy.rating ? ` ★${listingSeller.soldBy.rating}` : ""}
                    {listingSeller.onGhostCart ? " · on GhostCart, negotiating with them" : " · not on GhostCart yet"}
                  </p>
                )}
              </div>
            </>
          )}

          {quotes && quotes.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-paper-muted">
              {quotes.map((q) => (
                <li key={q.url} className="print-line flex justify-between">
                  <span>{q.seller}</span>
                  <span>
                    {inr(q.price)}
                    {q.inStock ? "" : " (oos)"}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {haggleLines.length > 0 && (
            <>
              <div className="receipt-rule my-4" />
              <div className="space-y-1.5">
                {haggleLines.map((line, i) => (
                  <p key={i} className="print-line">
                    &gt; {line}
                  </p>
                ))}
              </div>
            </>
          )}

          {offer && (
            <>
              <div className="receipt-rule my-4" />
              <div className="print-line flex items-baseline justify-between">
                <span>Opening offer</span>
                <span className="text-2xl font-semibold">{inr(offer.dealPrice)}</span>
              </div>
              <p className="text-right text-paper-muted">
                <s>{inr(offer.originalPrice)}</s> · now haggle for lower
              </p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
