import { Suspense } from "react";
import { MockPayment } from "@/components/mock-payment";

export const metadata = { title: "GhostCart · Test payment", robots: { index: false } };

export default function MockPayPage({ params }: PageProps<"/pay/mock/[orderId]">) {
  return (
    <main className="flex flex-1 flex-col items-center px-4 py-10">
      <Suspense fallback={<p className="text-muted">Loading payment…</p>}>
        <Order params={params} />
      </Suspense>
    </main>
  );
}

async function Order({ params }: { params: PageProps<"/pay/mock/[orderId]">["params"] }) {
  const { orderId } = await params;
  return <MockPayment orderId={decodeURIComponent(orderId)} />;
}
