import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { HaggleButton } from "@/components/shop/haggle-button";
import { PriceAlert } from "@/components/shop/price-alert";
import { SellerDetailsBlock } from "@/components/shop/seller-details";
import { sellerDetails } from "@/lib/shop/disclosure";
import { inr } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getLang } from "@/lib/lang";
import { reviewSummary } from "@/lib/reviews";
import { GRANT_PLATFORMS } from "@/lib/grants/adapters";
import { getProduct } from "@/lib/shop/products";
import { policyForProduct } from "@/lib/shop/policies";
import { allowedReturnUrl } from "@/lib/integrations/keys";
import { loadStorefront } from "@/lib/shop/storefront";

export const metadata = { title: "GhostCart Shop" };

export default function ShopProductPage({ params, searchParams }: PageProps<"/s/[slug]/[productId]">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pb-16 pt-8 sm:px-8">
      <Suspense fallback={<p className="mt-16 text-muted">Loading…</p>}>
        <ProductView params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function ProductView({ params, searchParams }: { params: PageProps<"/s/[slug]/[productId]">["params"]; searchParams: PageProps<"/s/[slug]/[productId]">["searchParams"] }) {
  await connection(); // live stock and prices: always render per request
  const { slug, productId } = await params;
  const shop = await loadStorefront(slug);
  const product = shop && (await getProduct(productId));
  if (!shop || !product || product.storeId !== shop.store.id || product.status !== "active") notFound();
  const { store, preview } = shop;
  const [policy, seller, lang, reviews] = await Promise.all([policyForProduct(product), sellerDetails(store), getLang(), reviewSummary({ productId: product.id })]);
  const raw = (await searchParams).return;
  const back = await allowedReturnUrl(store.id, typeof raw === "string" ? raw : undefined);

  return (
    <>
      {back ? (
        <a href={back} className="text-muted hover:text-fg">
          {t(lang, "product.back", { site: new URL(back).hostname })}
        </a>
      ) : (
        <Link href={`/s/${store.slug}`} className="text-muted hover:text-fg">
          ← {store.name}
        </Link>
      )}
      <div className="mt-6 grid grid-cols-1 gap-10 md:grid-cols-2">
        <div className="aspect-square overflow-hidden rounded-2xl bg-panel">
          {product.images[0] ? (
            <Image src={product.images[0]} alt={product.title} width={800} height={800} unoptimized className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center p-8 text-center text-muted">{product.title}</div>
          )}
        </div>
        <div>
          <h1 className="text-3xl font-bold leading-tight tracking-tight">{product.title}</h1>
          <p className="mt-4 text-2xl">
            <span className="font-semibold">{inr(product.price)}</span>
            {product.mrp && product.mrp > product.price && <s className="ml-3 text-lg text-muted">MRP {inr(product.mrp)}</s>}
          </p>
          <p className="mt-1 text-sm text-muted">
            {product.stock > 0 ? t(lang, "product.inStock", { n: product.stock }) : t(lang, "product.outOfStock")} · {t(lang, "product.shipsFrom", { store: store.name })}
          </p>
          <div className="mt-8">
            {preview ? (
              <p className="rounded-xl border border-saffron/60 px-4 py-3 text-sm">Preview: shoppers can haggle once your shop is live.</p>
            ) : policy.enabled ? (
              <div className="grid gap-3">
                <HaggleButton productId={product.id} disabled={product.stock < 1} label={t(lang, "product.offer")} returnUrl={back ?? undefined} lang={lang} />
                <PriceAlert productId={product.id} price={product.price} lang={lang} />
              </div>
            ) : (
              <p className="text-muted">{t(lang, "product.fixed")}</p>
            )}
          </div>
          {product.description && <p className="mt-8 whitespace-pre-line text-muted">{product.description}</p>}
          {product.countryOfOrigin && <p className="mt-4 text-sm text-muted">{t(lang, "product.origin", { c: product.countryOfOrigin })}</p>}
        </div>
      </div>
      {reviews.count > 0 && (
        <section aria-label="Reviews" className="mt-12">
          <h2 className="text-xl font-semibold">
            {reviews.average.toFixed(1)} ★ <span className="text-base font-normal text-muted">from {reviews.count} verified buyer{reviews.count === 1 ? "" : "s"}</span>
          </h2>
          <ul className="mt-4 grid gap-4">
            {reviews.latest.map((r) => (
              <li key={r.id} className="border-t border-line pt-4">
                <p>
                  <span aria-label={`${r.rating} out of 5`}>{"★".repeat(r.rating)}</span>
                  <span className="text-muted">{"★".repeat(5 - r.rating).replace(/★/g, "☆")}</span> <span className="text-sm text-muted">{r.authorName}</span>
                </p>
                {r.body && <p className="mt-1">{r.body}</p>}
                {r.sellerReply && <p className="mt-2 text-sm text-muted">{store.name} replied: {r.sellerReply}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <SellerDetailsBlock seller={seller} paidOn={GRANT_PLATFORMS.has(store.platform) ? store.name : undefined} />
    </>
  );
}
