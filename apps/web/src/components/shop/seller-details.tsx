import Link from "next/link";
import type { SellerDetails } from "@/lib/shop/disclosure";

/** Who the buyer is buying from, as the E-Commerce Rules require, plus returns and where to complain. */
export function SellerDetailsBlock({ seller, compact = false, paidOn }: { seller: SellerDetails; compact?: boolean; /** Set for Shopify/Woo stores: paid on their own checkout. */ paidOn?: string }) {
  return (
    <section aria-label="Seller details" className={`text-sm text-muted ${compact ? "" : "mt-16 border-t border-line pt-6"}`}>
      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        <div>
          <dt className="text-fg">Sold and shipped by</dt>
          <dd>
            {seller.legalName && seller.legalName !== seller.tradeName ? `${seller.legalName} (trading as ${seller.tradeName})` : (seller.legalName ?? seller.tradeName)}
            {seller.gstin && <span className="block">GSTIN {seller.gstin}</span>}
            {seller.address && <span className="block">{seller.address}</span>}
          </dd>
        </div>
        <div>
          <dt className="text-fg">Customer care</dt>
          <dd>
            {seller.supportPhone ? (
              <a href={`tel:${seller.supportPhone}`} className="underline-offset-4 hover:underline">
                {seller.supportPhone.replace(/^\+91(\d{5})(\d{5})$/, "+91 $1 $2")}
              </a>
            ) : (
              "Not provided yet"
            )}
            {seller.supportEmail && (
              <a href={`mailto:${seller.supportEmail}`} className="block underline-offset-4 hover:underline">
                {seller.supportEmail}
              </a>
            )}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-fg">Returns and refunds{seller.returnDays !== null ? `: ${seller.returnDays ? `${seller.returnDays} days from delivery` : "no returns"}` : ""}</dt>
          <dd className="whitespace-pre-line">{seller.returnPolicy ?? "The seller hasn't set a return policy yet."}</dd>
        </div>
      </dl>
      <p className="mt-4">
        {paidOn
          ? `You pay on ${paidOn}'s own checkout; GhostCart only agrees the price with you.`
          : "Payments by UPI through Pine Labs; the seller is paid after delivery. GhostCart runs this marketplace."}{" "}
        <Link href="/grievance" className="underline underline-offset-4">
          Make a complaint
        </Link>{" "}
        ·{" "}
        <Link href="/legal" className="underline underline-offset-4">
          Terms and policies
        </Link>
      </p>
    </section>
  );
}
