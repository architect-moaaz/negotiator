import Link from "next/link";

export const metadata = { title: "GhostCart · Terms and policies" };

const SECTIONS = [
  ["terms", "Terms of use"],
  ["privacy", "Privacy policy"],
  ["returns", "Returns, refunds and cancellations"],
  ["sellers", "Seller terms"],
] as const;

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-8 border-t border-line pt-8">
      <h2 className="text-2xl font-semibold">{title}</h2>
      <div className="mt-4 space-y-4 leading-relaxed text-muted [&_strong]:text-fg">{children}</div>
    </section>
  );
}

/**
 * Working drafts of GhostCart's legal pages. They describe what the product actually does today and are
 * marked as drafts until a lawyer has reviewed them. Keep them in step with the code they describe.
 */
export default function LegalPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 pb-16 pt-8 sm:px-8">
      <Link href="/" className="text-xl font-bold tracking-tight">
        GhostCart
      </Link>
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Terms and policies</h1>
        <p role="note" className="mt-4 rounded-xl border border-saffron/60 px-4 py-3">
          Draft, pending legal review. These pages describe how GhostCart works today. They&apos;ll be replaced by reviewed versions before we take payments from the public.
        </p>
        <nav aria-label="Policies" className="mt-6 flex flex-wrap gap-3">
          {SECTIONS.map(([id, title]) => (
            <a key={id} href={`#${id}`} className="rounded-full border border-line px-4 py-2 text-sm hover:border-saffron">
              {title}
            </a>
          ))}
        </nav>
      </header>

      <Section id="terms" title="Terms of use">
        <p>
          <strong>What GhostCart is.</strong> A marketplace where independent sellers list products and each seller&apos;s AI agent bargains with you on their behalf. The seller, not
          GhostCart, sells you the product, sets the prices and discount limits, ships the order and handles returns. Every shop and product page shows who the seller is.
        </p>
        <p>
          <strong>How prices are agreed.</strong> The agent is software. It can only offer prices within limits the seller has set; any offer beyond those limits goes to a person at the
          seller to accept or turn down. An agreed price is held for a short time shown on screen and becomes binding when you pay.
        </p>
        <p>
          <strong>Payments.</strong> You pay by UPI through Pine Labs, a payment aggregator licensed by the Reserve Bank of India. GhostCart doesn&apos;t hold your money; the seller&apos;s share is
          held by Pine Labs and released after delivery and the return window.
        </p>
        <p>
          <strong>Fair use.</strong> Don&apos;t use automated tools to haggle, open accounts in other people&apos;s names, or try to make the agent go beyond the seller&apos;s limits. We may block
          accounts that do.
        </p>
      </Section>

      <Section id="privacy" title="Privacy policy">
        <p>
          <strong>What we collect.</strong> Your name and mobile number (verified by a code), an email address if you give one, the city your device reports, your delivery address when you
          place an order, what you write to the agent, and a hashed identifier of your device to stop fraud. We don&apos;t ask for your age or gender.
        </p>
        <p>
          <strong>Why.</strong> To run your deals and orders, to let the seller and GhostCart contact you about them (only if you agree when signing up), and to prevent fraud. No marketing
          without separate consent, which we don&apos;t ask for today.
        </p>
        <p>
          <strong>Who sees it.</strong> The seller you buy from gets your name, phone and delivery address to ship your order. Pine Labs processes your payment. Courier tracking providers see
          the shipment number. We don&apos;t sell your data.
        </p>
        <p>
          <strong>Your rights.</strong> From <Link href="/account" className="underline underline-offset-4">your account</Link> you can see what you agreed to, withdraw consent, download your
          data and delete your account. When you delete it we erase your name, phone, email and messages. Records of orders you paid for are kept for 8 years, as accounting and tax law
          requires, with your name, phone and street removed.
        </p>
        <p>
          <strong>Complaints.</strong> Write to our grievance officer through the <Link href="/grievance" className="underline underline-offset-4">complaint form</Link>. We acknowledge within
          48 hours and resolve within a month.
        </p>
      </Section>

      <Section id="returns" title="Returns, refunds and cancellations">
        <p>
          <strong>Each seller&apos;s return policy</strong> is shown on their shop and product pages, with the number of days you have to return an item.
        </p>
        <p>
          <strong>If the seller doesn&apos;t ship</strong> within 48 hours of your order, it&apos;s cancelled and you&apos;re refunded in full automatically.
        </p>
        <p>
          <strong>If something goes wrong</strong> (not received, damaged, not as described), report it from your order page before the return window closes. The seller&apos;s payout is frozen
          while we look at both sides, and we refund you in full or in part if your claim is upheld.
        </p>
        <p>
          <strong>Refunds</strong> go back to the UPI account you paid from, through Pine Labs. The small fee you pay to lock a price is refunded with the order if the seller cancels or
          doesn&apos;t ship.
        </p>
      </Section>

      <Section id="sellers" title="Seller terms">
        <p>
          Sellers must verify their identity (PAN, and GSTIN where required), a payout bank account in the business&apos;s name, and that they control the store they list. They must publish a
          trading address, a customer care number and a return policy, ship within 48 hours, and add a real courier tracking number.
        </p>
        <p>
          New sellers have lower order limits and longer payout holds. Sellers can&apos;t buy from their own shops. Payouts are released after delivery and the buyer&apos;s dispute window.
        </p>
      </Section>
    </main>
  );
}
