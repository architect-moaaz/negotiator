import Image from "next/image";
import { connection } from "next/server";
import { Suspense } from "react";
import { StopOffers } from "@/components/privilege/stop-offers";
import { HaggleButton } from "@/components/shop/haggle-button";
import { SellerDetailsBlock } from "@/components/shop/seller-details";
import { LanguageSwitch } from "@/components/language-switch";
import { inr } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getLang } from "@/lib/lang";
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
  const [found, lang] = await Promise.all([resolveInvite(token), getLang()]);
  if (!found) {
    return (
      <div lang={lang} className="mt-16">
        <h1 className="text-3xl font-bold">{t(lang, "privilege.invalid")}</h1>
        <p className="mt-3 text-muted">{t(lang, "privilege.invalidHelp")}</p>
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
    <div lang={lang}>
      <div className="flex justify-end">
        <LanguageSwitch lang={lang} />
      </div>
      {back && (
        <a href={back} className="text-muted hover:text-fg">
          ← Back to {new URL(back).hostname}
        </a>
      )}
      <p className="mt-6 text-sm font-semibold uppercase tracking-wider text-saffron">{rescue ? "Rescue my cart" : t(lang, "privilege.kicker")}</p>
      <h1 className="mt-2 text-3xl font-bold leading-tight tracking-tight">
        {closed ? t(lang, "privilege.closed") : rescue ? `Make ${store.name} an offer` : t(lang, "privilege.title", { store: store.name })}
      </h1>
      {closed ? (
        <p className="mt-3 text-muted">{closed}</p>
      ) : (
        <p className="mt-3 text-muted">
          {t(lang, "privilege.intro", { store: store.name })}{" "}
          {GRANT_PLATFORMS.has(store.platform) ? t(lang, "privilege.payStore", { store: store.name }) : t(lang, "privilege.payGhostCart")}
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
          <span className="text-muted">{t(lang, "privilege.atList", { n: items })}</span>
          <span className="font-semibold">{inr(cart.subtotal)}</span>
        </li>
      </ul>

      {!closed && (
        <div className="mt-8 grid gap-4">
          <HaggleButton
            label={items === 1 ? t(lang, "product.offer") : t(lang, "privilege.offerAll", { n: items })}
            endpoint="/api/privilege/start"
            payload={{ token }}
            lang={lang}
          />
          <p className="text-sm text-muted">{t(lang, "privilege.until", { when: when(invite.expiresAt) })}</p>
        </div>
      )}
      {!rescue && cart.status !== "opted_out" && !closed && (
        <div className="mt-6 text-sm text-muted">
          <StopOffers token={token} storeName={store.name} lang={lang} />
        </div>
      )}
      <SellerDetailsBlock seller={seller} paidOn={GRANT_PLATFORMS.has(store.platform) ? store.name : undefined} />
    </div>
  );
}
