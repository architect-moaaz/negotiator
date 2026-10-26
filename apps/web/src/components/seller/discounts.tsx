"use client";

import { resolvePolicy, type DiscountPolicy } from "@ghostcart/core";
import { useState } from "react";
import { inr } from "@/lib/format";
import type { StoreData } from "./dashboard";
import { api, draftToPolicy, ErrorText, field, policyToDraft, PolicyPreview, secondary, type PolicyDraft } from "./ui";

type Level = { scope: "store" } | { scope: "category"; id: string; name: string } | { scope: "product"; id: string; name: string; price: number; categoryId: string | null };

/** One editable level. Empty fields inherit from the level above (shown as the placeholder). */
function LevelForm({ data, level, canEdit, onSaved }: { data: StoreData; level: Level; canEdit: boolean; onSaved: (p: StoreData["policies"]) => void }) {
  const own = level.scope === "store" ? data.policies.store : level.scope === "category" ? data.policies.categories[level.id] : data.policies.products[level.id];
  const [draft, setDraft] = useState<PolicyDraft>(policyToDraft(own));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const parentLevels =
    level.scope === "store"
      ? {}
      : level.scope === "category"
        ? { store: data.policies.store }
        : { store: data.policies.store, category: level.categoryId ? data.policies.categories[level.categoryId] : undefined };
  const inherited = resolvePolicy(parentLevels);
  const current = draftToPolicy(draft);
  const levels: Partial<Record<"store" | "category" | "product", DiscountPolicy>> = { ...parentLevels, [level.scope]: current };
  const price = level.scope === "product" ? level.price : (data.products.find((p) => level.scope === "store" || p.categoryId === level.id)?.price ?? 20000);
  const from = level.scope === "store" ? "default" : level.scope === "category" ? "store" : "category or store";

  async function save() {
    setError("");
    setSaved(false);
    const r = await api<StoreData["policies"]>(`/api/seller/stores/${data.store.id}/policies`, {
      method: "PUT",
      body: { scope: level.scope, targetId: level.scope === "store" ? null : level.id, policy: current },
    });
    if (!r.ok) return setError(r.error);
    setSaved(true);
    onSaved(r.data);
  }

  const num = (k: "maxDiscountPct" | "autoApprovePct" | "floorPrice" | "maxRounds", label: string, placeholder: string) => (
    <label className="grid gap-1">
      <span className="text-sm text-muted">{label}</span>
      <input
        inputMode="numeric"
        disabled={!canEdit}
        value={String(draft[k] ?? "")}
        placeholder={placeholder}
        onChange={(e) => {
          setSaved(false);
          setDraft({ ...draft, [k]: e.target.value });
        }}
        className={`${field} py-2`}
      />
    </label>
  );

  return (
    <form
      className="grid gap-3 border-t border-line py-5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">
          {level.scope === "store" ? "Store default" : level.name}
          {level.scope === "product" && <span className="ml-2 font-normal text-muted">{inr(level.price)}</span>}
        </h3>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            disabled={!canEdit}
            checked={(typeof draft.enabled === "boolean" ? draft.enabled : inherited.enabled) !== false}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            className="accent-saffron"
          />
          Haggling on
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {num("maxDiscountPct", "Max off (%)", level.scope === "store" ? "10" : `${inherited.maxDiscountPct} from ${from}`)}
        {num("autoApprovePct", "Agent alone (%)", level.scope === "store" ? "5" : `${inherited.autoApprovePct} from ${from}`)}
        {num("maxRounds", "Rounds", `${inherited.maxRounds}`)}
        {level.scope === "product" && num("floorPrice", "Lowest price (₹)", "none")}
      </div>
      <PolicyPreview levels={levels} price={price} />
      <ErrorText>{error}</ErrorText>
      {canEdit && (
        <div className="flex items-center gap-3">
          <button className={secondary}>Save</button>
          {saved && <span className="text-sm text-paid">Saved</span>}
        </div>
      )}
    </form>
  );
}

export function DiscountsTab({ data, canEdit, onSaved }: { data: StoreData; canEdit: boolean; onSaved: (p: StoreData["policies"]) => void }) {
  const [productId, setProductId] = useState("");
  const custom = data.products.filter((p) => data.policies.products[p.id] || p.id === productId);
  return (
    <section className="mt-6 max-w-3xl">
      <p className="text-muted">Rules flow down: a category can change the store default, and a product can change its category. Leave a box empty to inherit.</p>
      <div className="mt-4">
        <LevelForm key={`store-${JSON.stringify(data.policies.store)}`} data={data} level={{ scope: "store" }} canEdit={canEdit} onSaved={onSaved} />
      </div>
      {data.categories.length > 0 && <h2 className="mt-8 text-xl font-semibold">Categories</h2>}
      {data.categories.map((c) => (
        <LevelForm key={c.id} data={data} level={{ scope: "category", id: c.id, name: c.name }} canEdit={canEdit} onSaved={onSaved} />
      ))}
      <h2 className="mt-8 text-xl font-semibold">Products with their own rules</h2>
      {custom.map((p) => (
        <LevelForm key={p.id} data={data} level={{ scope: "product", id: p.id, name: p.title, price: p.price, categoryId: p.categoryId }} canEdit={canEdit} onSaved={onSaved} />
      ))}
      {canEdit && data.products.length > 0 && (
        <label className="mt-4 grid max-w-sm gap-2">
          <span className="text-sm text-muted">Give a product its own rules</span>
          <select value="" onChange={(e) => setProductId(e.target.value)} className={field}>
            <option value="">Choose a product…</option>
            {data.products
              .filter((p) => !custom.includes(p))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
          </select>
        </label>
      )}
    </section>
  );
}
