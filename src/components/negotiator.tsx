"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { inr } from "@/lib/format";
import type { NegotiationEvent, Offer, Product, SellerQuote } from "@/lib/types";

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

export function Negotiator() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [steps, setSteps] = useState<string[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [quotes, setQuotes] = useState<SellerQuote[] | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [haggle, setHaggle] = useState("");
  const [error, setError] = useState("");

  async function negotiate(body: Record<string, string>) {
    setPhase("running");
    setSteps([]);
    setProduct(null);
    setQuotes(null);
    setOffer(null);
    setHaggle("");
    setError("");

    try {
      const res = await fetch("/api/negotiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) {
        const { error } = await res.json().catch(() => ({ error: "" }));
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
    if (!file.type.startsWith("image/")) {
      setPhase("error");
      setError("Upload an image of your cart, wishlist or product page.");
      return;
    }
    negotiate(await readImage(file));
  }

  const busy = phase === "running" || phase === "done";
  const haggleLines = haggle.split("\n").filter((l) => l.trim());

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) negotiate({ url: url.trim() });
        }}
      >
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
          <button
            type="submit"
            disabled={busy || !url.trim()}
            className="rounded-xl bg-saffron px-6 py-4 text-lg font-semibold text-paper-ink transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? "Negotiating…" : "Find my deal"}
          </button>
        </div>
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
            onClick={() => fileRef.current?.click()}
            className="text-fg underline decoration-line decoration-2 underline-offset-4 hover:decoration-saffron disabled:opacity-50"
          >
            upload a cart screenshot
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
        {phase === "error" && (
          <p role="alert" className="mt-2 text-alarm">
            {error}
          </p>
        )}
      </form>

      {phase !== "idle" && phase !== "error" && (
        <section aria-live="polite" className="receipt px-6 py-8 text-[13px] leading-relaxed shadow-2xl shadow-black/40">
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
                <span>Your price</span>
                <span className="text-2xl font-semibold">{inr(offer.dealPrice)}</span>
              </div>
              <p className="text-right text-paper-muted">
                <s>{inr(offer.originalPrice)}</s> · you save {inr(offer.saved)}
              </p>
            </>
          )}
        </section>
      )}
    </div>
  );
}
