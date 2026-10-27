import Link from "next/link";
import { InviteCard } from "@/components/invite-card";
import { MyDeals } from "@/components/my-deals";

export const metadata = { title: "GhostCart · My deals", robots: { index: false } };

export default function AccountPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-16 pt-8 sm:px-8">
      <header className="flex items-center justify-between">
        <Link href="/" className="text-xl font-bold tracking-tight">
          GhostCart
        </Link>
        <Link href="/dashboard" className="text-muted hover:text-fg">
          Live deals
        </Link>
      </header>
      <MyDeals />
      <InviteCard />
    </main>
  );
}
