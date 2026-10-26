import Link from "next/link";
import { Suspense } from "react";
import { ConnectShopify } from "@/components/seller/connect-shopify";

export const metadata = { title: "GhostCart · Connect Shopify", robots: { index: false } };

export default function ConnectShopifyPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-16 pt-8 sm:px-8">
      <Link href="/" className="text-xl font-bold tracking-tight">
        GhostCart
      </Link>
      <h1 className="mt-14 text-[clamp(2rem,5vw,3rem)] font-bold leading-tight tracking-[-0.02em]">Connect your Shopify store</h1>
      <Suspense fallback={<p className="mt-16 text-muted">Loading…</p>}>
        <ConnectShopify />
      </Suspense>
    </main>
  );
}
