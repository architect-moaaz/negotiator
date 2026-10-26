"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ErrorText, field, primary, secondary } from "./ui";

type StepState = "missing" | "failed" | "in_review" | "done";
interface Checklist {
  status: string;
  reviewNote: string | null;
  platform: string;
  domain: string | null;
  steps: { business: StepState; gstin: StepState; bank: StepState; ownership: StepState; details: StepState };
  disclosure: Disclosure | null;
  canSubmit: boolean;
  org: { legalName?: string | null; businessType?: string | null };
  ownership: { txt: string; meta: string } | null;
  checks: { type: string; status: string; masked: string | null; reason: string | null }[];
}

interface Disclosure {
  address: string;
  city: string;
  state: string;
  pincode: string;
  supportPhone: string;
  supportEmail?: string;
  returnDays: number;
  returnPolicy: string;
}
const EMPTY_DISCLOSURE = { address: "", city: "", state: "", pincode: "", supportPhone: "", supportEmail: "", returnDays: "7", returnPolicy: "" };

const BADGE: Record<StepState, [string, string]> = {
  missing: ["To do", "text-muted"],
  failed: ["Needs fixing", "text-alarm"],
  in_review: ["With a reviewer", "text-saffron"],
  done: ["Verified", "text-paid"],
};

function Step({ n, title, state, doneLabel, children }: { n: number; title: string; state: StepState; doneLabel?: string; children: React.ReactNode }) {
  const [badge, tone] = BADGE[state];
  const label = state === "done" && doneLabel ? doneLabel : badge;
  return (
    <section className="border-t border-line py-6">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-lg font-semibold">
          {n}. {title}
        </h3>
        <span className={`text-sm ${tone}`}>{label}</span>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function VerificationTab({ storeId, canManage, onStatus }: { storeId: string; canManage: boolean; onStatus: () => void }) {
  const [data, setData] = useState<Checklist | null>(null);
  const [business, setBusiness] = useState({ legalName: "", businessType: "individual", pan: "", gstin: "" });
  const [bank, setBank] = useState({ holderName: "", account: "", confirm: "", ifsc: "" });
  const [details, setDetails] = useState<typeof EMPTY_DISCLOSURE | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const r = await api<Checklist>(`/api/seller/stores/${storeId}/verification`);
    if (r.ok) {
      setData(r.data);
      const d = r.data.disclosure;
      setDetails((cur) => cur ?? (d ? { ...d, supportPhone: d.supportPhone.replace(/^\+91/, ""), supportEmail: d.supportEmail ?? "", returnDays: String(d.returnDays) } : EMPTY_DISCLOSURE));
    }
  }, [storeId]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function run(key: string, path: string, body: unknown) {
    setBusy(key);
    setErrors((e) => ({ ...e, [key]: "" }));
    const r = await api<{ check?: { status: string; reason?: string | null } }>(`/api/seller/stores/${storeId}/verification/${path}`, { body });
    setBusy("");
    if (!r.ok) setErrors((e) => ({ ...e, [key]: r.error }));
    else if (r.data.check?.status === "failed" && r.data.check.reason) setErrors((e) => ({ ...e, [key]: r.data.check!.reason! }));
    await load();
    onStatus();
  }

  async function uploadPhoto(file: File | undefined, kind: "stock" | "marketplace") {
    if (!file) return;
    setBusy("photo");
    setErrors((e) => ({ ...e, photo: "" }));
    const body = new FormData();
    body.append("file", file);
    body.append("kind", kind);
    const res = await fetch(`/api/seller/stores/${storeId}/verification/photo`, { method: "POST", body });
    setBusy("");
    if (!res.ok) setErrors((e) => ({ ...e, photo: "Couldn't upload that photo. Use a JPG, PNG or WebP up to 5 MB." }));
    await load();
  }

  if (!data) return <p className="mt-6 text-muted">Loading…</p>;
  const latest = (type: string) => data.checks.find((c) => c.type === type);
  const editable = canManage && data.status === "draft";

  return (
    <div className="mt-6 max-w-3xl">
      {data.status === "pending_review" && <p className="rounded-xl border border-saffron/60 px-4 py-3">Submitted. A reviewer is checking your details, usually within one working day.</p>}
      {data.status === "live" && <p className="rounded-xl border border-paid/60 px-4 py-3 text-paid">Verified. Your store is live.</p>}
      {data.status === "draft" && data.reviewNote && (
        <p className="rounded-xl border border-alarm/60 px-4 py-3">
          <span className="font-semibold">The reviewer asked for a change:</span> {data.reviewNote}
        </p>
      )}
      {data.status === "draft" && !data.reviewNote && (
        <p className="text-muted">Shoppers can buy once you&apos;re verified. We check who you are, where your payouts go, and that the store is yours.</p>
      )}

      <Step n={1} title="Business details" state={data.steps.business === "done" && data.steps.gstin !== "done" ? data.steps.gstin : data.steps.business}>
        {latest("pan") && (
          <p className="mb-3 text-sm text-muted">
            On file: {data.org.legalName} · PAN {latest("pan")!.masked}
            {latest("gstin") ? ` · GSTIN ${latest("gstin")!.masked}` : ""}
          </p>
        )}
        {editable && (
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              run("business", "business", business);
            }}
          >
            <label className="grid gap-1 sm:col-span-2">
              <span className="text-sm text-muted">Legal name, exactly as on your PAN</span>
              <input required value={business.legalName} onChange={(e) => setBusiness({ ...business, legalName: e.target.value })} className={field} />
            </label>
            <label className="grid gap-1">
              <span className="text-sm text-muted">Business type</span>
              <select value={business.businessType} onChange={(e) => setBusiness({ ...business, businessType: e.target.value })} className={field}>
                <option value="individual">Individual</option>
                <option value="proprietorship">Sole proprietorship</option>
                <option value="partnership">Partnership</option>
                <option value="llp">LLP</option>
                <option value="company">Private or public company</option>
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-sm text-muted">PAN</span>
              <input required autoCapitalize="characters" maxLength={10} placeholder="ABCDE1234F" value={business.pan} onChange={(e) => setBusiness({ ...business, pan: e.target.value.toUpperCase() })} className={`${field} font-receipt`} />
            </label>
            <label className="grid gap-1 sm:col-span-2">
              <span className="text-sm text-muted">GSTIN {["company", "llp", "partnership"].includes(business.businessType) ? "" : "(if you have one)"}</span>
              <input autoCapitalize="characters" maxLength={15} placeholder="27ABCDE1234F1Z5" value={business.gstin} onChange={(e) => setBusiness({ ...business, gstin: e.target.value.toUpperCase() })} className={`${field} font-receipt`} />
            </label>
            <div className="sm:col-span-2">
              <ErrorText>{errors.business}</ErrorText>
              <button disabled={busy === "business"} className={secondary}>
                {busy === "business" ? "Checking…" : latest("pan") ? "Update details" : "Verify details"}
              </button>
            </div>
          </form>
        )}
      </Step>

      <Step n={2} title="Payout bank account" state={data.steps.bank}>
        {latest("bank") && <p className="mb-3 text-sm text-muted">On file: {latest("bank")!.masked}</p>}
        {editable && (
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (bank.account !== bank.confirm) return setErrors((x) => ({ ...x, bank: "The account numbers don't match." }));
              run("bank", "bank", { holderName: bank.holderName, account: bank.account, ifsc: bank.ifsc });
            }}
          >
            <label className="grid gap-1 sm:col-span-2">
              <span className="text-sm text-muted">Account holder name</span>
              <input required value={bank.holderName} onChange={(e) => setBank({ ...bank, holderName: e.target.value })} className={field} />
            </label>
            <label className="grid gap-1">
              <span className="text-sm text-muted">Account number</span>
              <input required inputMode="numeric" autoComplete="off" value={bank.account} onChange={(e) => setBank({ ...bank, account: e.target.value.replace(/\D/g, "") })} className={`${field} font-receipt`} />
            </label>
            <label className="grid gap-1">
              <span className="text-sm text-muted">Account number again</span>
              <input required inputMode="numeric" autoComplete="off" value={bank.confirm} onChange={(e) => setBank({ ...bank, confirm: e.target.value.replace(/\D/g, "") })} className={`${field} font-receipt`} />
            </label>
            <label className="grid gap-1">
              <span className="text-sm text-muted">IFSC</span>
              <input required autoCapitalize="characters" maxLength={11} placeholder="HDFC0001234" value={bank.ifsc} onChange={(e) => setBank({ ...bank, ifsc: e.target.value.toUpperCase() })} className={`${field} font-receipt`} />
            </label>
            <div className="sm:col-span-2">
              <p className="mb-2 text-sm text-muted">We send ₹1 to confirm the account and the name on it.</p>
              <ErrorText>{errors.bank}</ErrorText>
              <button disabled={busy === "bank"} className={secondary}>
                {busy === "bank" ? "Confirming…" : latest("bank") ? "Change account" : "Confirm account"}
              </button>
            </div>
          </form>
        )}
      </Step>

      <Step n={3} title="Show the store is yours" state={data.steps.ownership}>
        {data.ownership && data.domain && (
          <div className="grid gap-4">
            <p className="text-muted">
              Add one of these to <span className="text-fg">{data.domain}</span>, then check.
            </p>
            <div>
              <p className="text-sm text-muted">A DNS TXT record (at your domain provider):</p>
              <code className="mt-1 block select-all break-all rounded-lg bg-panel px-3 py-2 font-receipt text-sm">{data.ownership.txt}</code>
            </div>
            <div>
              <p className="text-sm text-muted">Or this tag in your home page&apos;s &lt;head&gt;:</p>
              <code className="mt-1 block select-all break-all rounded-lg bg-panel px-3 py-2 font-receipt text-sm">{data.ownership.meta}</code>
            </div>
            {editable && (
              <div className="flex gap-3">
                <button onClick={() => run("ownership", "ownership", { method: "dns" })} disabled={!!busy} className={secondary}>
                  {busy === "ownership" ? "Checking…" : "Check DNS"}
                </button>
                <button onClick={() => run("ownership", "ownership", { method: "meta" })} disabled={!!busy} className={secondary}>
                  Check meta tag
                </button>
              </div>
            )}
            <ErrorText>{errors.ownership}</ErrorText>
          </div>
        )}
        {(data.platform === "ghostcart_shop" || data.platform === "amazon" || data.platform === "flipkart") && (
          <div className="grid gap-3">
            <p className="text-muted">
              {data.platform === "ghostcart_shop"
                ? "Take a photo of the products you sell, with today's newspaper or a handwritten note saying \"GhostCart\" and today's date in the frame."
                : `Connect your ${data.platform === "amazon" ? "Amazon Seller Central" : "Flipkart Seller Hub"} account on the Integrations tab (that proves it's yours), or upload a screenshot of your seller profile showing your store name.`}
            </p>
            {editable && (
              <label className={`${secondary} w-fit cursor-pointer`}>
                {busy === "photo" ? "Uploading…" : latest(data.platform === "ghostcart_shop" ? "ownership_photo" : "ownership_marketplace") ? "Upload another" : "Upload photo"}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => uploadPhoto(e.target.files?.[0], data.platform === "ghostcart_shop" ? "stock" : "marketplace")} />
              </label>
            )}
            <ErrorText>{errors.photo}</ErrorText>
          </div>
        )}
      </Step>

      <Step n={4} title="Shop details for buyers" state={data.steps.details} doneLabel="Saved">
        <p className="mb-4 text-sm text-muted">
          The law asks marketplaces to show buyers who they&apos;re buying from: your address, a customer care number and your return policy. These appear on your shop and product pages
          {data.org.legalName ? `, next to your legal name (${data.org.legalName})` : ""}.
        </p>
        {canManage && details && (
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy("details");
              setErrors((x) => ({ ...x, details: "" }));
              const r = await api(`/api/seller/stores/${storeId}/disclosure`, { method: "PUT", body: details });
              setBusy("");
              if (!r.ok) setErrors((x) => ({ ...x, details: r.error }));
              await load();
            }}
          >
            <label className="grid gap-1 sm:col-span-2">
              <span className="text-sm text-muted">Street address you trade from</span>
              <input required autoComplete="street-address" value={details.address} onChange={(e) => setDetails({ ...details, address: e.target.value })} className={field} />
            </label>
            <label className="grid gap-1">
              <span className="text-sm text-muted">City</span>
              <input required value={details.city} onChange={(e) => setDetails({ ...details, city: e.target.value })} className={field} />
            </label>
            <label className="grid gap-1">
              <span className="text-sm text-muted">State</span>
              <input required value={details.state} onChange={(e) => setDetails({ ...details, state: e.target.value })} className={field} />
            </label>
            <label className="grid gap-1">
              <span className="text-sm text-muted">Pincode</span>
              <input required inputMode="numeric" maxLength={6} value={details.pincode} onChange={(e) => setDetails({ ...details, pincode: e.target.value.replace(/\D/g, "") })} className={`${field} font-receipt`} />
            </label>
            <label className="grid gap-1">
              <span className="text-sm text-muted">Customer care number</span>
              <input required inputMode="tel" placeholder="98765 43210" value={details.supportPhone} onChange={(e) => setDetails({ ...details, supportPhone: e.target.value })} className={field} />
            </label>
            <label className="grid gap-1">
              <span className="text-sm text-muted">Customer care email (optional)</span>
              <input type="email" value={details.supportEmail} onChange={(e) => setDetails({ ...details, supportEmail: e.target.value })} className={field} />
            </label>
            <label className="grid gap-1">
              <span className="text-sm text-muted">Days a buyer has to return an item</span>
              <input required inputMode="numeric" value={details.returnDays} onChange={(e) => setDetails({ ...details, returnDays: e.target.value.replace(/\D/g, "") })} className={field} />
            </label>
            <label className="grid gap-1 sm:col-span-2">
              <span className="text-sm text-muted">Return and refund policy, in plain words</span>
              <textarea
                required
                rows={3}
                placeholder="Unused items in original packaging can be returned within 7 days of delivery. We refund to your original payment method within 5 working days of receiving it."
                value={details.returnPolicy}
                onChange={(e) => setDetails({ ...details, returnPolicy: e.target.value })}
                className={field}
              />
            </label>
            <div className="sm:col-span-2">
              <ErrorText>{errors.details}</ErrorText>
              <button disabled={busy === "details"} className={secondary}>
                {busy === "details" ? "Saving…" : data.disclosure ? "Update shop details" : "Save shop details"}
              </button>
            </div>
          </form>
        )}
      </Step>

      {editable && (
        <div className="border-t border-line pt-6">
          <ErrorText>{errors.submit}</ErrorText>
          <button disabled={!data.canSubmit || busy === "submit"} onClick={() => run("submit", "submit", {})} className={primary}>
            Submit for review
          </button>
          {!data.canSubmit && <p className="mt-2 text-sm text-muted">Finish the four steps to submit.</p>}
        </div>
      )}
    </div>
  );
}
