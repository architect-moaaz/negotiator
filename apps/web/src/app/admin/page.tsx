import { AdminConsole } from "@/components/admin-console";

export const metadata = { title: "GhostCart · Proof of life", robots: { index: false } };

export default function AdminPage() {
  return (
    <main className="flex flex-1 flex-col px-4 pb-16 pt-8 sm:px-8">
      <AdminConsole />
    </main>
  );
}
