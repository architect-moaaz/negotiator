"use client";

import { useEffect, useState } from "react";

interface Alert {
  id: string;
  productId: string;
  title: string;
  url: string | null;
  targetPrice: number;
}

/** The shopper's invite link, and their price alerts with a way to remove each. */
export function InviteCard() {
  const [invite, setInvite] = useState<{ url: string; joined: number } | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [copied, setCopied] = useState(false);
  const loadAlerts = () =>
    fetch("/api/alerts", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { alerts: [] }))
      .then((d) => setAlerts(d.alerts));
  useEffect(() => {
    fetch("/api/me/invite", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setInvite);
    loadAlerts();
  }, []);
  if (!invite) return null;
  return (
    <section className="mt-10 grid gap-6">
      <div className="rounded-2xl border border-line p-5">
        <h2 className="font-semibold">Invite friends</h2>
        <p className="mt-1 text-sm text-muted">Share your link. {invite.joined ? `${invite.joined} ${invite.joined === 1 ? "person has" : "people have"} joined through it.` : "Nobody has joined through it yet."}</p>
        <div className="mt-3 flex gap-2">
          <input readOnly value={invite.url} aria-label="Your invite link" className="min-w-0 flex-1 rounded-xl border border-line bg-panel px-3 py-2 font-receipt text-sm" />
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(invite.url).catch(() => {});
              setCopied(true);
            }}
            className="rounded-xl border border-line px-3 py-2 hover:border-saffron"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      {alerts.length > 0 && (
        <div className="rounded-2xl border border-line p-5">
          <h2 className="font-semibold">Your price alerts</h2>
          <ul className="mt-2 grid gap-2">
            {alerts.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3">
                <span>
                  {a.url ? (
                    <a href={a.url} className="underline underline-offset-4">
                      {a.title}
                    </a>
                  ) : (
                    a.title
                  )}{" "}
                  <span className="text-muted">at ₹{a.targetPrice.toLocaleString("en-IN")} or less</span>
                </span>
                <button
                  onClick={async () => {
                    await fetch("/api/alerts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: a.id }) });
                    loadAlerts();
                  }}
                  className="text-sm text-muted underline hover:text-fg"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
