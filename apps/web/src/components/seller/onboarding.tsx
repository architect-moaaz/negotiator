"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PhoneLogin } from "../phone-login";
import { api, ErrorText, field, PolicyPreview, primary } from "./ui";

type Platform = "ghostcart_shop" | "website" | "shopify" | "woocommerce" | "amazon" | "flipkart";

const WAYS: { value: Platform; label: string; detail: string }[] = [
  { value: "ghostcart_shop", label: "I don't have a website", detail: "Get a free GhostCart shop link to share on WhatsApp and Instagram. Add products from your phone." },
  { value: "amazon", label: "I sell on Amazon", detail: "Start by uploading your catalogue as a CSV. Connecting your Seller Central account to import listings comes next." },
  { value: "flipkart", label: "I sell on Flipkart", detail: "Start with a CSV of your catalogue. Connecting your Flipkart seller account comes next." },
  { value: "website", label: "I have my own website", detail: "Add the GhostCart haggle button to your product pages." },
  { value: "shopify", label: "My store is on Shopify", detail: "Install the GhostCart app from your Shopify admin; it imports your products and adds the haggle button." },
  { value: "woocommerce", label: "My store is on WooCommerce", detail: "Install the GhostCart plugin; it syncs your products, adds the haggle button and creates coupons for agreed prices." },
];
const NEEDS_DOMAIN = new Set<Platform>(["website", "shopify", "woocommerce"]);

interface Account {
  phone: string;
  orgs: { id: string; name: string; role: string }[];
}

export function SellerOnboarding() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [step, setStep] = useState<"business" | "how" | "rules">("business");
  const [form, setForm] = useState({ businessName: "", ownerName: "", storeName: "", platform: "" as Platform | "", domain: "", maxDiscountPct: "10", autoApprovePct: "5" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function loadAccount() {
    const r = await api<Account>("/api/seller/account");
    setAccount(r.ok ? r.data : null);
  }
  useEffect(() => {
    const t = setTimeout(loadAccount, 0);
    return () => clearTimeout(t);
  }, []);

  const existingOrg = account?.orgs.find((o) => o.role === "owner");

  async function finish() {
    setBusy(true);
    setError("");
    const r = await api<{ store: { id: string } }>("/api/seller/onboard", {
      body: {
        ...(existingOrg ? { orgId: existingOrg.id } : { businessName: form.businessName, ownerName: form.ownerName }),
        storeName: form.storeName || form.businessName || existingOrg?.name,
        platform: form.platform,
        domain: form.domain || undefined,
        maxDiscountPct: Number(form.maxDiscountPct),
        autoApprovePct: Number(form.autoApprovePct),
      },
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.push(`/seller?store=${r.data.store.id}`);
  }

  if (account === undefined) return <p className="mt-16 text-muted">Loading…</p>;

  if (account === null) {
    return (
      <section className="mt-10 max-w-md">
        <h2 className="text-2xl font-semibold">Start with your mobile number</h2>
        <p className="mt-2 text-muted">We call it with a 6-digit code. No passwords.</p>
        <div className="mt-6">
          <PhoneLogin role="member" onDone={loadAccount} />
        </div>
      </section>
    );
  }

  const steps = ["business", "how", "rules"] as const;
  return (
    <section className="mt-10 max-w-2xl">
      <ol className="flex gap-4 text-sm text-muted" aria-label="Steps">
        {["Your business", "How you sell", "Your discounts"].map((label, i) => (
          <li key={label} aria-current={steps[i] === step ? "step" : undefined} className={steps[i] === step ? "text-fg" : ""}>
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {step === "business" && (
        <form
          className="mt-8 grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            setStep("how");
          }}
        >
          {existingOrg ? (
            <p className="text-muted">
              Adding a new store to <span className="text-fg">{existingOrg.name}</span>.
            </p>
          ) : (
            <>
              <label className="grid gap-2">
                <span className="text-muted">Business name (as on your GST or bank account)</span>
                <input required value={form.businessName} onChange={set("businessName")} className={field} />
              </label>
              <label className="grid gap-2">
                <span className="text-muted">Your name</span>
                <input required autoComplete="name" value={form.ownerName} onChange={set("ownerName")} className={field} />
              </label>
            </>
          )}
          <label className="grid gap-2">
            <span className="text-muted">Store name shoppers will see</span>
            <input required={!!existingOrg} placeholder={form.businessName || "Sharma Electronics"} value={form.storeName} onChange={set("storeName")} className={field} />
          </label>
          <button className={primary}>Next</button>
        </form>
      )}

      {step === "how" && (
        <form
          className="mt-8 grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.platform) return setError("Pick how you sell.");
            if (NEEDS_DOMAIN.has(form.platform) && !form.domain.trim()) return setError("Add your website address.");
            setError("");
            setStep("rules");
          }}
        >
          <fieldset className="grid gap-3">
            <legend className="mb-2 text-muted">Where do you sell today?</legend>
            {WAYS.map((w) => (
              <label key={w.value} className={`flex cursor-pointer gap-3 rounded-xl border p-4 ${form.platform === w.value ? "border-saffron" : "border-line hover:border-muted"}`}>
                <input type="radio" name="platform" value={w.value} checked={form.platform === w.value} onChange={() => setForm({ ...form, platform: w.value })} className="mt-1 accent-saffron" />
                <span>
                  <span className="font-semibold">{w.label}</span>
                  <span className="mt-1 block text-sm text-muted">{w.detail}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {form.platform && NEEDS_DOMAIN.has(form.platform) && (
            <label className="mt-2 grid gap-2">
              <span className="text-muted">Website address</span>
              <input inputMode="url" placeholder="sharmaelectronics.in" value={form.domain} onChange={set("domain")} className={field} />
            </label>
          )}
          <ErrorText>{error}</ErrorText>
          <div className="mt-2 flex gap-3">
            <button type="button" onClick={() => setStep("business")} className="rounded-xl border border-line px-6 py-3.5 hover:border-saffron">
              Back
            </button>
            <button className={`${primary} flex-1`}>Next</button>
          </div>
        </form>
      )}

      {step === "rules" && (
        <form
          className="mt-8 grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            finish();
          }}
        >
          <p className="text-muted">These apply to every product. You can change them per category or product later.</p>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <label className="grid gap-2">
              <span className="text-muted">Most you&apos;d ever take off (%)</span>
              <input type="number" min={0} max={90} required value={form.maxDiscountPct} onChange={set("maxDiscountPct")} className={field} />
            </label>
            <label className="grid gap-2">
              <span className="text-muted">What your agent can give without asking (%)</span>
              <input type="number" min={0} max={90} required value={form.autoApprovePct} onChange={set("autoApprovePct")} className={field} />
            </label>
          </div>
          <PolicyPreview levels={{ store: { maxDiscountPct: Number(form.maxDiscountPct) || 0, autoApprovePct: Number(form.autoApprovePct) || 0 } }} price={20000} />
          <ErrorText>{error}</ErrorText>
          <div className="flex gap-3">
            <button type="button" onClick={() => setStep("how")} className="rounded-xl border border-line px-6 py-3.5 hover:border-saffron">
              Back
            </button>
            <button disabled={busy} className={`${primary} flex-1`}>
              {busy ? "Setting up…" : "Create my store"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
