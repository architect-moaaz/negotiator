"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PhoneLogin } from "../phone-login";
import { api, ErrorText, field, primary } from "./ui";

interface Account {
  orgs: { id: string; name: string; role: string; stores: { id: string; name: string; platform: string }[] }[];
}

/** After installing the Shopify app: sign in and attach the shop to a GhostCart business. */
export function ConnectShopify() {
  const shop = useSearchParams().get("shop") ?? "";
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [orgId, setOrgId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [form, setForm] = useState({ businessName: "", ownerName: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const r = await api<Account>("/api/seller/account");
    setAccount(r.ok ? r.data : null);
    if (r.ok) setOrgId(r.data.orgs.find((o) => o.role === "owner")?.id ?? "");
  }, []);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function connect() {
    setBusy(true);
    setError("");
    const r = await api<{ storeId: string; imported: number; approveBillingUrl: string | null }>("/api/seller/connect/shopify", {
      body: { shop, orgId: orgId || undefined, storeId: storeId || undefined, ...(orgId ? {} : form) },
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    window.location.href = r.data.approveBillingUrl ?? `/seller?store=${r.data.storeId}`;
  }

  if (!shop) return <p className="mt-16 text-muted">Open this from the GhostCart app in your Shopify admin.</p>;
  if (account === undefined) return <p className="mt-16 text-muted">Loading…</p>;
  if (account === null) {
    return (
      <section className="mt-10 max-w-md">
        <p className="text-muted">Sign in with your mobile number to finish connecting {shop}.</p>
        <div className="mt-6">
          <PhoneLogin role="member" onDone={load} />
        </div>
      </section>
    );
  }
  const owned = account.orgs.filter((o) => o.role === "owner");
  const shopifyStores = owned.find((o) => o.id === orgId)?.stores.filter((s) => s.platform === "shopify") ?? [];
  return (
    <form
      className="mt-10 grid max-w-xl gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        connect();
      }}
    >
      {owned.length > 0 && (
        <label className="grid gap-2">
          <span className="text-muted">Business</span>
          <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className={field}>
            {owned.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
            <option value="">A new business</option>
          </select>
        </label>
      )}
      {!orgId && (
        <>
          <label className="grid gap-2">
            <span className="text-muted">Business name (as on your GST or bank account)</span>
            <input required value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} className={field} />
          </label>
          <label className="grid gap-2">
            <span className="text-muted">Your name</span>
            <input required value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} className={field} />
          </label>
        </>
      )}
      {shopifyStores.length > 0 && (
        <label className="grid gap-2">
          <span className="text-muted">Connect to</span>
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className={field}>
            <option value="">A new GhostCart store for {shop}</option>
            {shopifyStores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="text-muted">We&apos;ll import your products, add the haggle button to your theme&apos;s app embeds, and start your agent at up to 10% off (change it any time).</p>
      <ErrorText>{error}</ErrorText>
      <button disabled={busy} className={primary}>
        {busy ? "Connecting…" : `Connect ${shop}`}
      </button>
    </form>
  );
}
