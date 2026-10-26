"use client";

import { useState } from "react";
import { inr } from "@/lib/format";
import type { ProductRow, StoreData } from "./dashboard";
import { api, ErrorText, field, primary, secondary } from "./ui";

const empty = { title: "", price: "", mrp: "", stock: "1", category: "", sku: "", description: "", image: "", countryOfOrigin: "India", brand: "", gtin: "", modelNumber: "" };

export function ProductsTab({ data, canEdit, reload }: { data: StoreData; canEdit: boolean; reload: () => void }) {
  const [editing, setEditing] = useState<ProductRow | "new" | null>(null);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [importNote, setImportNote] = useState<{ created: number; errors: string[] } | null>(null);
  const [uploading, setUploading] = useState(false);

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError("");
    const body = new FormData();
    body.append("file", file);
    const res = await fetch(`/api/seller/stores/${data.store.id}/uploads`, { method: "POST", body });
    const out = await res.json().catch(() => ({}));
    setUploading(false);
    if (!res.ok) return setError(out.error || "Couldn't upload that photo.");
    setForm((f) => ({ ...f, image: out.url }));
  }
  const categoryName = (id: string | null) => data.categories.find((c) => c.id === id)?.name ?? "";
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  function open(p: ProductRow | "new") {
    setEditing(p);
    setError("");
    setForm(
      p === "new"
        ? empty
        : { title: p.title, price: String(p.price), mrp: p.mrp ? String(p.mrp) : "", stock: String(p.stock), category: categoryName(p.categoryId), sku: p.sku ?? "", description: p.description, image: p.images[0] ?? "", countryOfOrigin: p.countryOfOrigin ?? "", brand: p.brand ?? "", gtin: p.gtin ?? "", modelNumber: p.modelNumber ?? "" },
    );
  }

  async function save() {
    setBusy(true);
    setError("");
    const body = {
      title: form.title,
      price: form.price,
      mrp: form.mrp || undefined,
      stock: form.stock || 0,
      category: form.category || undefined,
      sku: form.sku || undefined,
      description: form.description,
      images: form.image ? [form.image] : [],
      countryOfOrigin: form.countryOfOrigin || undefined,
      brand: form.brand,
      gtin: form.gtin,
      modelNumber: form.modelNumber,
      status: editing !== "new" && editing ? editing.status : "active",
    };
    const r = editing === "new" ? await api(`/api/seller/stores/${data.store.id}/products`, { body }) : await api(`/api/seller/stores/${data.store.id}/products/${editing!.id}`, { method: "PUT", body });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setEditing(null);
    reload();
  }

  async function setStatus(p: ProductRow, status: string) {
    await api(`/api/seller/stores/${data.store.id}/products/${p.id}`, {
      method: "PUT",
      body: { title: p.title, price: p.price, mrp: p.mrp ?? undefined, stock: p.stock, category: categoryName(p.categoryId) || undefined, sku: p.sku ?? undefined, description: p.description, images: p.images, countryOfOrigin: p.countryOfOrigin ?? undefined, status },
    });
    reload();
  }

  async function importCsv(file: File | undefined) {
    if (!file) return;
    setImportNote(null);
    setBusy(true);
    const r = await api<{ created: number; errors: string[] }>(`/api/seller/stores/${data.store.id}/import`, { body: { csv: await file.text() } });
    setBusy(false);
    setImportNote(r.ok ? r.data : { created: 0, errors: [r.error] });
    reload();
  }

  return (
    <section className="mt-6">
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => open("new")} className={secondary}>
            Add a product
          </button>
          <label className={`${secondary} cursor-pointer`}>
            Import a CSV
            <input type="file" accept=".csv,text/csv" className="sr-only" disabled={busy} onChange={(e) => importCsv(e.target.files?.[0])} />
          </label>
          <a href="data:text/csv;charset=utf-8,title,price,mrp,stock,category,sku,description,image_url,country_of_origin%0ARedmi 13C 4GB,7999,9999,5,Phones,RD13,,,India%0A" download="ghostcart-catalogue-template.csv" className="text-sm text-muted underline underline-offset-4 hover:text-fg">
            Download the CSV template
          </a>
        </div>
      )}
      {importNote && (
        <div className="mt-4 rounded-xl border border-line p-4">
          <p>{importNote.created} products imported.</p>
          {importNote.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm text-alarm">
              {importNote.errors.slice(0, 10).map((e) => (
                <li key={e}>{e}</li>
              ))}
              {importNote.errors.length > 10 && <li>…and {importNote.errors.length - 10} more</li>}
            </ul>
          )}
        </div>
      )}

      {editing && (
        <form
          className="mt-6 grid gap-4 rounded-2xl border border-line p-5"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <h2 className="text-xl font-semibold">{editing === "new" ? "New product" : `Edit ${editing.title}`}</h2>
          <label className="grid gap-2">
            <span className="text-muted">Name</span>
            <input required value={form.title} onChange={set("title")} className={field} />
          </label>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <label className="grid gap-2">
              <span className="text-muted">Price (₹)</span>
              <input required inputMode="numeric" value={form.price} onChange={set("price")} className={field} />
            </label>
            <label className="grid gap-2">
              <span className="text-muted">MRP (₹)</span>
              <input inputMode="numeric" value={form.mrp} onChange={set("mrp")} className={field} />
            </label>
            <label className="grid gap-2">
              <span className="text-muted">In stock</span>
              <input inputMode="numeric" value={form.stock} onChange={set("stock")} className={field} />
            </label>
            <label className="grid gap-2">
              <span className="text-muted">Category</span>
              <input list="category-names" value={form.category} onChange={set("category")} className={field} />
              <datalist id="category-names">
                {data.categories.map((c) => (
                  <option key={c.id} value={c.name} />
                ))}
              </datalist>
            </label>
          </div>
          <label className="grid gap-2 sm:max-w-xs">
            <span className="text-muted">Country of origin</span>
            <input value={form.countryOfOrigin} onChange={set("countryOfOrigin")} className={field} />
          </label>
          <fieldset className="grid gap-2">
            <legend className="text-muted">Brand, barcode and model (optional: shoppers find this exact item when they bring a marketplace cart)</legend>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <input aria-label="Brand" placeholder="Brand" value={form.brand} onChange={set("brand")} className={field} />
              <input aria-label="Barcode (EAN or UPC)" placeholder="Barcode (EAN/UPC)" inputMode="numeric" value={form.gtin} onChange={set("gtin")} className={field} />
              <input aria-label="Model number" placeholder="Model number" value={form.modelNumber} onChange={set("modelNumber")} className={field} />
            </div>
          </fieldset>
          <div className="grid gap-2">
            <span className="text-muted">Photo</span>
            <div className="flex items-center gap-4">
              {form.image && (
                // eslint-disable-next-line @next/next/no-img-element -- seller's own upload, any host
                <img src={form.image} alt="" className="size-20 rounded-lg object-cover" />
              )}
              <label className={`${secondary} cursor-pointer`}>
                {uploading ? "Uploading…" : form.image ? "Change photo" : "Take or choose a photo"}
                <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" disabled={uploading} onChange={(e) => upload(e.target.files?.[0])} />
              </label>
              {form.image && (
                <button type="button" onClick={() => setForm({ ...form, image: "" })} className="text-sm text-muted underline underline-offset-4">
                  Remove
                </button>
              )}
            </div>
          </div>
          <label className="grid gap-2">
            <span className="text-muted">Description</span>
            <textarea rows={3} value={form.description} onChange={set("description")} className={field} />
          </label>
          <ErrorText>{error}</ErrorText>
          <div className="flex gap-3">
            <button type="button" onClick={() => setEditing(null)} className={secondary}>
              Cancel
            </button>
            <button disabled={busy || uploading} className={primary}>
              {busy ? "Saving…" : "Save product"}
            </button>
          </div>
        </form>
      )}

      {data.products.length === 0 ? (
        <p className="py-10 text-muted">No products yet. Add one, or import your catalogue from a CSV.</p>
      ) : (
        <table className="mt-6 w-full text-left">
          <thead className="text-sm text-muted">
            <tr>
              <th className="py-2 font-normal">Product</th>
              <th className="py-2 font-normal">Category</th>
              <th className="py-2 text-right font-normal">Price</th>
              <th className="py-2 text-right font-normal">Stock</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {data.products.map((p) => (
              <tr key={p.id} className="border-t border-line">
                <td className="py-3 pr-4">
                  {p.title}
                  {p.status === "draft" && <span className="ml-2 text-sm text-muted">(hidden)</span>}
                </td>
                <td className="py-3 pr-4 text-muted">{categoryName(p.categoryId)}</td>
                <td className="py-3 text-right tabular-nums">{inr(p.price)}</td>
                <td className={`py-3 text-right tabular-nums ${p.stock === 0 ? "text-alarm" : ""}`}>{p.stock}</td>
                <td className="py-3 pl-4 text-right text-sm">
                  {canEdit && (
                    <span className="flex justify-end gap-3">
                      <button onClick={() => open(p)} className="underline underline-offset-4">
                        Edit
                      </button>
                      <button onClick={() => setStatus(p, p.status === "draft" ? "active" : "draft")} className="text-muted underline underline-offset-4 hover:text-fg">
                        {p.status === "draft" ? "Show" : "Hide"}
                      </button>
                      <button onClick={() => setStatus(p, "archived")} className="text-muted underline underline-offset-4 hover:text-alarm">
                        Remove
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
