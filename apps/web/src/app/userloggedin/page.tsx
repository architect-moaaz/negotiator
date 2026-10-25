import { UserInsightsView } from "@/components/user-insights";

export const metadata = { title: "GhostCart · Users", robots: { index: false } };

export default function UserLoggedInPage() {
  return (
    <main className="flex flex-1 flex-col px-4 pb-16 pt-8 sm:px-8">
      <UserInsightsView />
    </main>
  );
}
