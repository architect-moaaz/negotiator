import { RescueFlow } from "@/components/privilege/rescue-flow";

export const metadata = {
  title: "Rescue my cart · GhostCart",
  description: "Bring the cart you built on another site and make GhostCart sellers an offer on the same items.",
};

export default function RescuePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-16 pt-8 sm:px-8">
      <p className="text-sm font-semibold uppercase tracking-wider text-saffron">Rescue my cart</p>
      <h1 className="mt-2 text-3xl font-bold leading-tight tracking-tight">Got a cart somewhere else? Make an offer here.</h1>
      <p className="mt-3 text-muted">
        Paste the product links from your cart, or upload a screenshot. We show GhostCart sellers who have the same items, and you haggle with them directly.
      </p>
      <RescueFlow />
    </main>
  );
}
