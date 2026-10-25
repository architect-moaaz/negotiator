import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AccountLink } from "@/components/account-link";
import { CatalogueGrid } from "@/components/catalogue-grid";
import { Ticker } from "@/components/ticker";
import { liveShops, searchCatalogue } from "@/lib/shop/catalogue";

export default function Home() {
  return (
    <>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-16 pt-8 sm:px-8">
        <header className="flex items-center justify-between">
          <span className="text-xl font-bold tracking-tight">GhostCart</span>
          <nav className="flex gap-5">
            <Link href="/sell" className="text-muted hover:text-fg">
              For sellers
            </Link>
            <AccountLink />
          </nav>
        </header>

        <section className="mt-14 sm:mt-20">
          <h1 className="max-w-3xl text-[clamp(2.4rem,6.5vw,5rem)] font-bold leading-[0.95] tracking-[-0.03em]">Every price here is open to a bargain.</h1>
          <p className="mt-6 max-w-xl text-lg text-muted sm:text-xl">
            Real sellers, each with their own AI agent. Make an offer and haggle; anything bigger than the agent can give goes to the seller.
          </p>
          <form action="/search" className="mt-8 flex max-w-2xl flex-col gap-3 sm:flex-row">
            <label htmlFor="q" className="sr-only">
              Search products
            </label>
            <input
              id="q"
              name="q"
              type="search"
              placeholder="Kurta, earbuds, steel bottle…"
              className="min-w-0 flex-1 rounded-xl border border-line bg-panel px-4 py-4 text-lg text-fg placeholder:text-muted/60 focus:border-saffron focus:outline-none"
            />
            <button className="rounded-xl bg-saffron px-6 py-4 text-lg font-semibold text-paper-ink">Search</button>
          </form>
        </section>

        <Suspense fallback={<p className="mt-16 text-muted">Loading what&apos;s on offer…</p>}>
          <OnOffer />
        </Suspense>

        <section aria-label="How it works" className="mt-20 grid grid-cols-1 gap-6 border-t border-line pt-8 sm:grid-cols-3">
          <div>
            <p className="font-semibold">You make the offer</p>
            <p className="mt-1 text-muted">Bargain in your own words. The agent counters within the discount the seller set.</p>
          </div>
          <div>
            <p className="font-semibold">A person signs off on big discounts</p>
            <p className="mt-1 text-muted">Offers past the agent&apos;s limit go to the seller, on their phone or dashboard.</p>
          </div>
          <div>
            <p className="font-semibold">Paid safely</p>
            <p className="mt-1 text-muted">UPI through Pine Labs. The seller is paid only after your order is delivered.</p>
          </div>
        </section>
      </main>
      <Ticker />
    </>
  );
}

async function OnOffer() {
  await connection();
  const [items, shops] = await Promise.all([searchCatalogue("", 12), liveShops(8)]);
  if (!items.length) return <p className="mt-16 text-muted">The first sellers are setting up their shops. Check back soon.</p>;
  return (
    <>
      <section className="mt-16">
        <h2 className="text-2xl font-semibold">On offer now</h2>
        <div className="mt-6">
          <CatalogueGrid items={items} />
        </div>
      </section>
      {shops.length > 0 && (
        <section className="mt-14">
          <h2 className="text-2xl font-semibold">Shops</h2>
          <ul className="mt-4 flex flex-wrap gap-3">
            {shops.map((s) => (
              <li key={s.slug}>
                <Link href={`/s/${s.slug}`} className="block rounded-full border border-line px-4 py-2 hover:border-saffron">
                  {s.name} <span className="text-muted">· {s.products}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
