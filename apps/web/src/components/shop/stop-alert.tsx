"use client";

import { use, useState } from "react";

export function StopAlert({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [done, setDone] = useState(false);
  if (done) return <p role="status" className="mt-6">Stopped.</p>;
  return (
    <button
      onClick={async () => {
        const res = await fetch("/api/alerts/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
        if (res.ok) setDone(true);
      }}
      className="mt-6 rounded-xl bg-saffron px-6 py-3.5 text-lg font-semibold text-paper-ink"
    >
      Stop the alert
    </button>
  );
}
