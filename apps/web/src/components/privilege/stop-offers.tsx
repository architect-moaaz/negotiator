"use client";

import { useState } from "react";
import { t, type Lang } from "@/lib/i18n";

/** One tap, no sign-in: no more private offers for this cart. */
export function StopOffers({ token, storeName, lang = "en" }: { token: string; storeName: string; lang?: Lang }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  async function stop() {
    setState("busy");
    const res = await fetch("/api/privilege/stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
    setState(res.ok ? "done" : "error");
  }
  if (state === "done") return <p role="status">{t(lang, "privilege.stopped", { store: storeName })}</p>;
  return (
    <p>
      {t(lang, "privilege.stopAsk")}{" "}
      <button onClick={stop} disabled={state === "busy"} className="underline hover:text-fg disabled:opacity-50">
        {t(lang, "privilege.stop")}
      </button>
      {state === "error" && <span role="alert" className="ml-2 text-alarm">That didn&apos;t work. Try again.</span>}
    </p>
  );
}
