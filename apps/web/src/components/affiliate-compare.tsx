import Image from "next/image";
import { inr } from "@/lib/format";
import type { Comparison } from "@/lib/affiliate/compare";

const NAME = { amazon: "Amazon", flipkart: "Flipkart" } as const;

/**
 * Prices elsewhere, for comparison only. Links are affiliate links; we say so, show when the prices
 * were checked, and never offer cashback or a discount funded by the commission.
 */
export function AffiliateCompare({ comparison }: { comparison: Comparison }) {
  if (!comparison.offers.length) return null;
  const checked = new Date(comparison.checkedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  return (
    <section className="mt-14 border-t border-line pt-8">
      <h2 className="text-xl font-semibold">Compare with Amazon and Flipkart</h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {comparison.offers.map((o) => (
          <li key={`${o.source}-${o.url}`}>
            <a href={o.url} target="_blank" rel="sponsored noopener" className="flex items-center gap-4 rounded-xl border border-line p-3 hover:border-saffron">
              {o.image ? (
                <Image src={o.image} alt="" width={64} height={64} unoptimized className="size-16 shrink-0 rounded-lg object-cover" />
              ) : (
                <span className="size-16 shrink-0 rounded-lg bg-panel" />
              )}
              <span className="min-w-0">
                <span className="block text-sm text-muted">{NAME[o.source]}</span>
                <span className="line-clamp-2">{o.title}</span>
                <span className="font-semibold">{inr(o.price)}</span>
                {o.mrp && o.mrp > o.price && <s className="ml-2 text-sm text-muted">{inr(o.mrp)}</s>}
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted">
        Prices and availability from Amazon and Flipkart as of {checked}; they may have changed. GhostCart may earn a commission if you buy through these links. These
        prices aren&apos;t negotiable on GhostCart.
      </p>
    </section>
  );
}
