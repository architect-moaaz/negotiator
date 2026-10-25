import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { inr } from "@/lib/format";
import { loadStorefront, storefrontCatalogue } from "@/lib/shop/storefront";

export const metadata = { title: "GhostCart Shop" };

export default function ShopPage({ params }: PageProps<"/s/[slug]">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-16 pt-8 sm:px-8">
      <Suspense fallback={<p className="mt-16 text-muted">Opening the shop…</p>}>
        <Shop params={params} />
      </Suspense>
    </main>
  );
}

async function Shop({ params }: { params: PageProps<"/s/[slug]">["params"] }) {
  await connection(); // live stock and prices: always render per request
  const { slug } = await params;
  const shop = await loadStorefront(slug);
  if (!shop) notFound();
  const { store, preview } = shop;
  const { products, categories } = await storefrontCatalogue(store.id);

  return (
    <>
      {preview && (
        <p className="mb-6 rounded-xl border border-saffron/60 px-4 py-3 text-sm">
          Preview: only you can see this shop until it&apos;s verified and live.{" "}
          <Link href={`/seller?store=${store.id}`} className="underline underline-offset-4">
            Back to your dashboard
          </Link>
        </p>
      )}
      <header>
        <h1 className="text-[clamp(2rem,5vw,3rem)] font-bold leading-tight tracking-[-0.02em]">{store.name}</h1>
        <p className="mt-2 max-w-xl text-muted">Every price here is open to a bargain with the shop&apos;s own agent. Make an offer; the seller ships your order.</p>
      </header>

      {products.length === 0 ? (
        <p className="mt-16 text-muted">Nothing in the shop yet. Check back soon.</p>
      ) : (
        <>
          {categories.length > 1 && (
            <nav aria-label="Categories" className="mt-8 flex flex-wrap gap-2">
              {categories.map((c) => (
                <a key={c.id} href={`#${c.id}`} className="rounded-full border border-line px-3 py-1 text-sm text-muted hover:border-saffron hover:text-fg">
                  {c.name}
                </a>
              ))}
            </nav>
          )}
          {[...categories, { id: "", name: categories.length ? "More" : "" }].map((c) => {
            const items = products.filter((p) => (p.categoryId ?? "") === c.id);
            if (!items.length) return null;
            return (
              <section key={c.id || "rest"} id={c.id || undefined} className="mt-10">
                {c.name && <h2 className="text-xl font-semibold">{c.name}</h2>}
                <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                  {items.map((p) => (
                    <li key={p.id}>
                      <Link href={`/s/${store.slug}/${p.id}`} className="group block">
                        <div className="aspect-square overflow-hidden rounded-xl bg-panel">
                          {p.images[0] ? (
                            <Image src={p.images[0]} alt="" width={400} height={400} unoptimized className="size-full object-cover transition-transform group-hover:scale-[1.02]" />
                          ) : (
                            <div className="flex size-full items-center justify-center p-4 text-center text-sm text-muted">{p.title}</div>
                          )}
                        </div>
                        <p className="mt-2 line-clamp-2 group-hover:underline">{p.title}</p>
                        <p className="mt-1">
                          <span className="font-semibold">{inr(p.price)}</span>
                          {p.mrp && p.mrp > p.price && <s className="ml-2 text-sm text-muted">{inr(p.mrp)}</s>}
                        </p>
                        {p.stock === 0 && <p className="text-sm text-alarm">Out of stock</p>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}
      <footer className="mt-16 border-t border-line pt-6 text-sm text-muted">
        Sold and shipped by {store.name}. Payments by UPI through Pine Labs. <Link href="/" className="underline underline-offset-4">GhostCart</Link>
      </footer>
    </>
  );
}
