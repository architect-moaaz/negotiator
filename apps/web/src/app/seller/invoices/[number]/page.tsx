import { Suspense } from "react";
import { InvoiceView } from "@/components/seller/invoice-view";

export const metadata = { title: "GhostCart · Tax invoice", robots: { index: false } };

export default function InvoicePage({ params }: PageProps<"/seller/invoices/[number]">) {
  return (
    <Suspense fallback={<p className="p-8 text-muted">Loading…</p>}>
      <InvoiceView params={params} />
    </Suspense>
  );
}
