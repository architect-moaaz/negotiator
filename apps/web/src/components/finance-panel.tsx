"use client";

import { useEffect, useState } from "react";
import { ReconciliationPanel } from "./reconciliation-panel";

interface Finance {
  balanced: boolean;
  total: number;
  unbalanced: string[];
  accounts: Record<string, number>;
  gateway: string | null;
  checked: number;
  mismatches: { orderId: string; state: string; ledgerHeld: number; gatewayHeld: number }[];
}

const rupees = (paise: number) => `${paise < 0 ? "−" : ""}₹${(Math.abs(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

/** Owner-only ledger health: the release gate for every money change. */
export function FinancePanel() {
  const [data, setData] = useState<Finance | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/admin/finance", { cache: "no-store" })
      .then(async (r) => (r.ok ? setData(await r.json()) : setError((await r.json().catch(() => ({}))).error ?? "Couldn't load the ledger.")))
      .catch(() => setError("Couldn't load the ledger."));
  }, []);
  if (error) return <p className="mt-6 text-alarm">{error}</p>;
  if (!data) return <p className="mt-6 text-muted">Checking the ledger…</p>;
  return (
    <div className="mt-6 max-w-3xl space-y-6">
      <p className={data.balanced ? "text-paid" : "text-alarm"}>
        {data.balanced ? "Ledger balances: every transaction sums to zero." : `Ledger is off by ${rupees(data.total)}; unbalanced transactions: ${data.unbalanced.join(", ")}`}
      </p>
      <p className={data.mismatches.length ? "text-alarm" : "text-muted"}>
        {data.gateway ? `Checked ${data.checked} holds against the ${data.gateway} gateway: ${data.mismatches.length} mismatches.` : "No settlement gateway on this deployment, so nothing to reconcile."}
      </p>
      {data.mismatches.length > 0 && (
        <ul className="list-disc pl-5 text-alarm">
          {data.mismatches.map((m) => (
            <li key={m.orderId}>
              {m.orderId} ({m.state}): ledger holds {rupees(m.ledgerHeld)}, gateway holds {rupees(m.gatewayHeld)}
            </li>
          ))}
        </ul>
      )}
      <ReconciliationPanel />
      <table className="w-full text-left text-sm">
        <thead className="text-muted">
          <tr>
            <th className="py-2 font-normal">Account</th>
            <th className="py-2 text-right font-normal">Balance (debit +)</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(data.accounts)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([account, total]) => (
              <tr key={account} className="border-t border-line">
                <td className="py-2 font-receipt">{account}</td>
                <td className="py-2 text-right tabular-nums">{rupees(total)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
