import { Suspense } from "react";

export default function DealPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="min-h-screen bg-black p-8 text-white">
      <Suspense fallback={<p className="text-white/50">Loading deal…</p>}>
        <DealTerminal params={params} />
      </Suspense>
    </main>
  );
}

async function DealTerminal({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // TODO: client countdown terminal — fetch /api/deal?id=, show QR + 180s timer, poll status.
  return <h1 className="text-2xl font-semibold">Deal {id}</h1>;
}
