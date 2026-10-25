"use client";

import type { DiscountPolicy } from "@ghostcart/core";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { inr } from "@/lib/format";
import { PhoneLogin } from "../phone-login";
import { ApprovalsTab } from "./approvals";
import { DiscountsTab } from "./discounts";
import { IntegrationsTab } from "./integrations";
import { OrdersTab } from "./orders";
import { ProductsTab } from "./products";
import { VerificationTab } from "./verification";
import { api } from "./ui";

export interface StoreSummary {
  id: string;
  name: string;
  slug: string;
  platform: string;
  status: string;
  tier: string;
  domain: string | null;
}
interface Account {
  phone: string;
  orgs: { id: string; name: string; role: string; stores: StoreSummary[] }[];
}
export interface ProductRow {
  id: string;
  title: string;
  description: string;
  price: number;
  mrp: number | null;
  stock: number;
  categoryId: string | null;
  sku: string | null;
  images: string[];
  status: string;
}
export interface StoreData {
  store: StoreSummary;
  role: string;
  categories: { id: string; name: string }[];
  products: ProductRow[];
  policies: { store: DiscountPolicy; categories: Record<string, DiscountPolicy>; products: Record<string, DiscountPolicy> };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const STATUS: Record<string, string> = {
  draft: "Draft: shoppers can't see this store yet. Get verified to go live.",
  pending_review: "Waiting for review. We'll message you when it's live.",
  live: "Live",
  suspended: "Suspended. Contact GhostCart support.",
};

export function SellerDashboard() {
  const router = useRouter();
  const params = useSearchParams();
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [data, setData] = useState<StoreData | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [tab, setTab] = useState<"approvals" | "orders" | "products" | "discounts" | "integrations" | "verification">("products");

  const stores = account?.orgs.flatMap((o) => o.stores) ?? [];
  const storeId = params.get("store") ?? stores[0]?.id;

  const loadAccount = useCallback(async () => {
    const r = await api<Account>("/api/seller/account");
    setAccount(r.ok ? r.data : null);
  }, []);
  const loadStore = useCallback(async (id: string) => {
    const r = await api<StoreData>(`/api/seller/stores/${id}`);
    setData(r.ok ? r.data : null);
  }, []);

  useEffect(() => {
    const t = setTimeout(loadAccount, 0);
    return () => clearTimeout(t);
  }, [loadAccount]);
  useEffect(() => {
    if (!storeId) return;
    const t = setTimeout(() => loadStore(storeId), 0);
    return () => clearTimeout(t);
  }, [storeId, loadStore]);
  // Keep the approvals badge current whichever tab is open.
  useEffect(() => {
    if (!storeId) return;
    const poll = async () => {
      const r = await api<{ waiting: unknown[] }>(`/api/seller/stores/${storeId}/approvals`);
      if (r.ok) setWaiting(r.data.waiting.length);
    };
    const first = setTimeout(poll, 0);
    const t = setInterval(poll, 15000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [storeId]);

  if (account === undefined) return <p className="mt-16 text-muted">Loading…</p>;
  if (account === null) {
    return (
      <section className="mx-auto mt-16 w-full max-w-md">
        <h1 className="text-3xl font-bold tracking-tight">Seller sign in</h1>
        <p className="mt-2 text-muted">We call your number with a one-time code.</p>
        <div className="mt-8">
          <PhoneLogin role="member" onDone={loadAccount} />
        </div>
        <p className="mt-8 text-muted">
          New to GhostCart?{" "}
          <Link href="/seller/start" className="text-fg underline underline-offset-4">
            Set up your store
          </Link>
        </p>
      </section>
    );
  }
  if (!stores.length) {
    return (
      <section className="mx-auto mt-16 w-full max-w-md">
        <h1 className="text-3xl font-bold tracking-tight">No store yet</h1>
        <p className="mt-2 text-muted">Set one up in about two minutes.</p>
        <Link href="/seller/start" className="mt-8 inline-block rounded-xl bg-saffron px-6 py-3.5 text-lg font-semibold text-paper-ink">
          Set up your store
        </Link>
      </section>
    );
  }

  const canEdit = data && ["owner", "admin"].includes(data.role);
  return (
    <div className="mx-auto w-full max-w-5xl">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-xl font-bold tracking-tight">
            GhostCart
          </Link>
          <label className="sr-only" htmlFor="store-picker">
            Store
          </label>
          <select
            id="store-picker"
            value={storeId}
            onChange={(e) => router.replace(`/seller?store=${e.target.value}`)}
            className="rounded-lg border border-line bg-panel px-3 py-2"
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted">
          <span>{account.phone}</span>
          <Link href="/seller/start" className="hover:text-fg">
            Add a store
          </Link>
          <button
            onClick={async () => {
              await api("/api/auth/logout", { body: { role: "member" } });
              setAccount(null);
              setData(null);
            }}
            className="underline underline-offset-4 hover:text-fg"
          >
            Sign out
          </button>
        </div>
      </header>

      {!data ? (
        <p className="mt-16 text-muted">Loading store…</p>
      ) : (
        <>
          <section className="mt-10">
            <h1 className="text-3xl font-bold tracking-tight">{data.store.name}</h1>
            <p className={`mt-2 ${data.store.status === "live" ? "text-paid" : "text-muted"}`}>{STATUS[data.store.status] ?? data.store.status}</p>
            {data.store.platform === "ghostcart_shop" && (
              <p className="mt-1">
                Your shop:{" "}
                <Link href={`/s/${data.store.slug}`} className="text-saffron underline underline-offset-4">
                  /s/{data.store.slug}
                </Link>
                {data.store.status !== "live" && <span className="text-muted"> (preview)</span>}
              </p>
            )}
            <p className="mt-1 text-sm text-muted">
              {plural(data.products.length, "product")} · {plural(data.categories.length, "category", "categories")} · store default up to{" "}
              {data.policies.store.maxDiscountPct ?? 10}% off
              {data.products[0] ? ` · e.g. ${data.products[0].title} at ${inr(data.products[0].price)}` : ""}
            </p>
          </section>

          <div role="tablist" className="mt-8 flex gap-6 border-b border-line">
            {(["approvals", "orders", "products", "discounts", ...(data.role === "owner" ? (["integrations"] as const) : []), "verification"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`-mb-px border-b-2 pb-3 capitalize ${tab === t ? "border-saffron text-fg" : "border-transparent text-muted hover:text-fg"}`}
              >
                {t}
                {t === "approvals" && waiting > 0 && <span className="ml-2 rounded-full bg-saffron px-2 text-sm text-paper-ink">{waiting}</span>}
              </button>
            ))}
          </div>

          {tab === "approvals" && <ApprovalsTab storeId={data.store.id} canApprove={["owner", "admin", "approver"].includes(data.role)} onCount={setWaiting} />}
          {tab === "orders" && <OrdersTab storeId={data.store.id} canAct={["owner", "admin"].includes(data.role)} />}
          {tab === "products" && <ProductsTab data={data} canEdit={!!canEdit} reload={() => loadStore(data.store.id)} />}
          {tab === "discounts" && <DiscountsTab data={data} canEdit={!!canEdit} onSaved={(policies) => setData({ ...data, policies })} />}
          {tab === "integrations" && <IntegrationsTab storeId={data.store.id} domain={data.store.domain} />}
          {tab === "verification" && <VerificationTab storeId={data.store.id} canManage={data.role === "owner"} onStatus={() => loadStore(data.store.id)} />}
        </>
      )}
    </div>
  );
}
