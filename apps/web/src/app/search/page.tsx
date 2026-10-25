import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { CatalogueGrid } from "@/components/catalogue-grid";
import { searchCatalogue } from "@/lib/shop/catalogue";

export const metadata = { title: "GhostCart · Search" };

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-16 pt-8 sm:px-8">
      <Link href="/" className="text-xl font-bold tracking-tight">
        GhostCart
      </Link>
      <Suspense fallback={<p className="mt-16 text-muted">Searching…</p>}>
        <Results searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Results({ searchParams }: { searchParams: PageProps<"/search">["searchParams"] }) {
  await connection();
  const raw = (await searchParams).q;
  const q = (typeof raw === "string" ? raw : "").trim().slice(0, 80);
  const items = await searchCatalogue(q, 48);
  return (
    <>
      <form action="/search" className="mt-10 flex max-w-2xl gap-3">
        <label htmlFor="q" className="sr-only">
          Search products
        </label>
        <input id="q" name="q" type="search" defaultValue={q} className="min-w-0 flex-1 rounded-xl border border-line bg-panel px-4 py-3 text-fg focus:border-saffron focus:outline-none" />
        <button className="rounded-xl bg-saffron px-5 py-3 font-semibold text-paper-ink">Search</button>
      </form>
      <h1 className="mt-10 text-2xl font-semibold">{q ? `Results for "${q}"` : "Everything on offer"}</h1>
      {items.length === 0 ? (
        <p className="mt-6 text-muted">Nothing matches yet. Try a broader word.</p>
      ) : (
        <div className="mt-6">
          <CatalogueGrid items={items} />
        </div>
      )}
    </>
  );
}
