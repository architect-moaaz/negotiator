import Image from "next/image";
import Link from "next/link";
import { inr } from "@/lib/format";
import type { CatalogueItem } from "@/lib/shop/catalogue";

/** Product cards linking to each seller's haggle page. */
export function CatalogueGrid({ items }: { items: CatalogueItem[] }) {
  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((p) => (
        <li key={p.productId}>
          <Link href={`/s/${p.storeSlug}/${p.productId}`} className="group block">
            <div className="aspect-square overflow-hidden rounded-xl bg-panel">
              {p.image ? (
                <Image src={p.image} alt="" width={400} height={400} unoptimized className="size-full object-cover transition-transform group-hover:scale-[1.02]" />
              ) : (
                <div className="flex size-full items-center justify-center p-4 text-center text-sm text-muted">{p.title}</div>
              )}
            </div>
            <p className="mt-2 line-clamp-2 group-hover:underline">{p.title}</p>
            <p className="mt-1">
              <span className="font-semibold">{inr(p.price)}</span>
              {p.mrp && p.mrp > p.price && <s className="ml-2 text-sm text-muted">{inr(p.mrp)}</s>}
            </p>
            <p className="text-sm text-muted">
              {p.sponsored && <span className="mr-1 rounded border border-line px-1 text-xs">Sponsored</span>}
              {p.storeName} · make an offer
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
