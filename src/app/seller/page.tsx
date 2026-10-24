import { SellerConsole } from "@/components/seller-console";

export const metadata = { title: "GhostCart · Seller dashboard", robots: { index: false } };

export default function SellerPage() {
  return (
    <main className="flex flex-1 flex-col px-4 pb-16 pt-8 sm:px-8">
      <SellerConsole />
    </main>
  );
}
