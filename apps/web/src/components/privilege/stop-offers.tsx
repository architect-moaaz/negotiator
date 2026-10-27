"use client";

import { useState } from "react";

/** One tap, no sign-in: no more private offers for this cart. */
export function StopOffers({ token, storeName }: { token: string; storeName: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  async function stop() {
    setState("busy");
    const res = await fetch("/api/privilege/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    setState(res.ok ? "done" : "error");
  }
  if (state === "done") return <p role="status">Done. {storeName} won&apos;t send you offers on this cart again.</p>;
  return (
    <p>
      Don&apos;t want offers on this cart?{" "}
      <button onClick={stop} disabled={state === "busy"} className="underline hover:text-fg disabled:opacity-50">
        Stop offers
      </button>
      {state === "error" && <span role="alert" className="ml-2 text-alarm">That didn&apos;t work. Try again.</span>}
    </p>
  );
}
