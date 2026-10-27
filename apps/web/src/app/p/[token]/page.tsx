import Image from "next/image";
import { connection } from "next/server";
import { Suspense } from "react";
import { StopOffers } from "@/components/privilege/stop-offers";
import { HaggleButton } from "@/components/shop/haggle-button";
import { SellerDetailsBlock } from "@/components/shop/seller-details";
import { inr } from "@/lib/format";
import { GRANT_PLATFORMS } from "@/lib/grants/adapters";
import { allowedReturnUrl } from "@/lib/integrations/keys";
import { resolveInvite } from "@/lib/privilege/invites";
import { sellerDetails } from "@/lib/shop/disclosure";

// A private link: keep it out of search engines and other sites' referrer logs.
export const metadata = { title: "Your private offer · GhostCart", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default function PrivilegePage({ params, searchParams }: PageProps<"/p/[token]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-16 pt-8 sm:px-8">
      <Suspense fallback={<p className="mt-16 text-muted">Loading…</p>}>
        <PrivilegeView params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const when = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

async function PrivilegeView({ params, searchParams }: { params: PageProps<"/p/[token]">["params"]; searchParams: PageProps<"/p/[token]">["searchParams"] }) {
  await connection(); // live stock, prices and status
  const { token } = await params;
  const found = await resolveInvite(token);
  if (!found) {
    return (
      <div className="mt-16">
        <h1 className="text-3xl font-bold">This link isn&apos;t valid</h1>
        <p className="mt-3 text-muted">Check you copied the whole link from your message.</p>
      </div>
    );
  }
  const { invite, cart, store, closed } = found;
  const raw = (await searchParams).return;
  const back = (await allowedReturnUrl(store.id, typeof raw === "string" ? raw : cart.returnUrl)) ?? undefined;
  const items = cart.lines.reduce((s, l) => s + l.quantity, 0);
  const seller = await sellerDetails(store);
  const rescue = cart.source === "rescue";

  return (
    <>
      {back && (
        <a href={back} className="text-muted hover:text-fg">
          ← Back to {new URL(back).hostname}
        </a>
      )}
      <p className="mt-6 text-sm font-semibold uppercase tracking-wider text-saffron">{rescue ? "Rescue my cart" : "GhostCart Privilege"}</p>
      <h1 className="mt-2 text-3xl font-bold leading-tight tracking-tight">
        {closed ? "This offer is closed" : rescue ? `Make ${store.name} an offer` : `A private offer on your cart from ${store.name}`}
      </h1>
      {closed ? (
        <p className="mt-3 text-muted">{closed}</p>
      ) : (
        <p className="mt-3 text-muted">
          Make {store.name} an offer on everything below. Their agent answers straight away, and anything it can&apos;t agree goes to the seller.{" "}
          {GRANT_PLATFORMS.has(store.platform)
            ? `If you agree a price, you pay on ${store.name}'s own checkout with a one-time code.`
            : "If you agree a price, you pay on GhostCart's checkout by UPI."}
        </p>
      )}

      <ul className="mt-8 divide-y divide-line rounded-2xl border border-line">
        {cart.lines.map((l) => (
          <li key={l.productId} className="flex items-center gap-4 p-4">
            <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-panel">
              {l.image && <Image src={l.image} alt="" width={64} height={64} unoptimized className="size-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{l.title}</p>
              <p className="text-sm text-muted">
                {l.quantity} × {inr(l.unitPrice)}
              </p>
            </div>
            <p className="font-semibold">{inr(l.unitPrice * l.quantity)}</p>
          </li>
        ))}
        <li className="flex justify-between p-4">
          <span className="text-muted">
            {items} item{items === 1 ? "" : "s"} at list price
          </span>
          <span className="font-semibold">{inr(cart.subtotal)}</span>
        </li>
      </ul>

      {!closed && (
        <div className="mt-8 grid gap-4">
          <HaggleButton label={items === 1 ? "Make an offer" : `Make an offer on all ${items} items`} endpoint="/api/privilege/start" payload={{ token }} />
          <p className="text-sm text-muted">This link works until {when(invite.expiresAt)} IST. Prices are checked again when you start.</p>
        </div>
      )}
      {!rescue && cart.status !== "opted_out" && !closed && (
        <div className="mt-6 text-sm text-muted">
          <StopOffers token={token} storeName={store.name} />
        </div>
      )}
      <SellerDetailsBlock seller={seller} paidOn={GRANT_PLATFORMS.has(store.platform) ? store.name : undefined} />
    </>
  );
}
