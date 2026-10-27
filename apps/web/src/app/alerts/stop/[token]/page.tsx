import { StopAlert } from "@/components/shop/stop-alert";

export const metadata = { title: "Stop a price alert · GhostCart", robots: { index: false, follow: false } };

/** The stop link in an alert message. A button (not the visit itself) stops it, so mail scanners can't. */
export default async function StopAlertPage({ params }: PageProps<"/alerts/stop/[token]">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pb-16 pt-16 sm:px-8">
      <h1 className="text-2xl font-bold">Stop this price alert?</h1>
      <p className="mt-2 text-muted">You won&apos;t hear about this product&apos;s price again unless you set a new alert.</p>
      <StopAlert params={params} />
    </main>
  );
}
