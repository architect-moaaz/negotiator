import Link from "next/link";
import { SellerSignup } from "@/components/seller-signup";
import { SocialProof } from "@/components/social-proof";

export const metadata = { title: "GhostCart · Sell with GhostCart" };

export default function SellPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-16 pt-8 sm:px-8">
      <header className="flex items-center justify-between">
        <Link href="/" className="text-xl font-bold tracking-tight">
          GhostCart
        </Link>
        <Link href="/seller" className="text-muted hover:text-fg">
          Seller dashboard
        </Link>
      </header>
      <h1 className="mt-14 text-[clamp(2rem,5vw,3.25rem)] font-bold leading-[1] tracking-[-0.02em]">
        Shoppers are already trying to buy from you. Let your agent close them.
      </h1>
      <p className="mt-5 max-w-xl text-lg text-muted">
        When a shopper pastes one of your Amazon or Flipkart listings into GhostCart, an agent haggles for you within the discount you set. Anything
        bigger comes to you to approve.
      </p>
      <div className="mt-5">
        <SocialProof variant="seller" />
      </div>
      <SellerSignup />
    </main>
  );
}
