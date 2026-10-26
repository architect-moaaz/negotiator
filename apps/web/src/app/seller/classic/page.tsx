import { SellerConsole } from "@/components/seller-console";

export const metadata = { title: "GhostCart · Marketplace seller approvals", robots: { index: false } };

/** Hackathon-era console for sellers matched by their Amazon/Flipkart seller name. Replaced by the Wave 2 marketplace connection. */
export default function ClassicSellerPage() {
  return (
    <main className="flex flex-1 flex-col px-4 pb-16 pt-8 sm:px-8">
      <SellerConsole />
    </main>
  );
}
