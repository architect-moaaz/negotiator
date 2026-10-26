"use client";

import { use, useEffect, useState } from "react";

interface Data {
  invoice: {
    number: string;
    period: string;
    issuedAt: string;
    sellerName: string;
    sellerGstin: string | null;
    sellerAddress: string | null;
    placeOfSupply: string | null;
    taxable: number;
    cgst: number;
    sgst: number;
    igst: number;
    total: number;
    lines: { ref: string; at: string; fee: number; gst: number }[];
  };
  issuer: { legalName: string; gstin: string | null; address: string | null; stateCode: string; sac: string };
}

const rs = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const month = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

/** GhostCart's tax invoice to a seller for its platform fee: printable, on paper colours. */
export function InvoiceView({ params }: { params: Promise<{ number: string }> }) {
  const { number } = use(params);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch(`/api/seller/invoices/${encodeURIComponent(decodeURIComponent(number))}`, { cache: "no-store" }).then(async (r) => (r.ok ? setData(await r.json()) : setError((await r.json().catch(() => ({}))).error ?? "Couldn't load the invoice.")));
  }, [number]);

  if (error) return <p className="p-8 text-alarm">{error}</p>;
  if (!data) return <p className="p-8 text-muted">Loading…</p>;
  const { invoice: i, issuer } = data;
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <div className="mb-4 flex justify-end print:hidden">
        <button onClick={() => window.print()} className="rounded-xl border border-line px-4 py-2 hover:border-saffron">
          Print or save as PDF
        </button>
      </div>
      <article className="receipt px-8 py-10 text-sm leading-relaxed">
        <header className="flex flex-wrap justify-between gap-6">
          <div>
            <p className="text-xl font-semibold">Tax invoice</p>
            <p className="text-paper-muted">{i.number}</p>
            <p className="text-paper-muted">Issued {new Date(i.issuedAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })} · fees for {month(i.period)}</p>
          </div>
          <div className="text-right">
            <p className="font-semibold">{issuer.legalName}</p>
            {issuer.address && <p className="text-paper-muted">{issuer.address}</p>}
            <p className="text-paper-muted">GSTIN {issuer.gstin ?? "pending registration"}</p>
          </div>
        </header>
        <div className="receipt-rule my-6" />
        <section>
          <p className="text-paper-muted">Billed to</p>
          <p className="font-semibold">{i.sellerName}</p>
          {i.sellerAddress && <p>{i.sellerAddress}</p>}
          <p>GSTIN {i.sellerGstin ?? "unregistered"} · Place of supply {i.placeOfSupply ?? "not given"}</p>
        </section>
        <table className="mt-6 w-full text-left">
          <thead className="text-paper-muted">
            <tr>
              <th className="py-1 font-normal">Platform fee (SAC {issuer.sac})</th>
              <th className="py-1 font-normal">Date</th>
              <th className="py-1 text-right font-normal">Fee</th>
            </tr>
          </thead>
          <tbody>
            {i.lines.map((l, n) => (
              <tr key={n} className="border-t border-paper-ink/10">
                <td className="py-1">{l.ref}</td>
                <td className="py-1">{new Date(l.at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                <td className="py-1 text-right tabular-nums">{rs(l.fee)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="receipt-rule my-6" />
        <dl className="ml-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 tabular-nums">
          <dt>Taxable value</dt>
          <dd className="text-right">{rs(i.taxable)}</dd>
          {i.igst > 0 ? (
            <>
              <dt>IGST 18%</dt>
              <dd className="text-right">{rs(i.igst)}</dd>
            </>
          ) : (
            <>
              <dt>CGST 9%</dt>
              <dd className="text-right">{rs(i.cgst)}</dd>
              <dt>SGST 9%</dt>
              <dd className="text-right">{rs(i.sgst)}</dd>
            </>
          )}
          <dt className="font-semibold">Total</dt>
          <dd className="text-right font-semibold">{rs(i.total)}</dd>
        </dl>
        <p className="mt-8 text-paper-muted">How it&apos;s paid: deducted from your payouts for orders paid through GhostCart; for orders on your own checkout, through your Shopify bill or as fees due on your dashboard.</p>
      </article>
    </main>
  );
}
