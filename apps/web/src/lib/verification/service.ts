import { isValidGstin, isValidPan, maskAccount, maskPan, panFromGstin, TIER_LIMITS, type SellerTier } from "@ghostcart/core";
import { schema } from "@ghostcart/db";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "../db";
import { newId } from "../shop/ids";
import { getStore, updateStore, type Store } from "../shop/stores";
import { store as kv } from "../store";
import { identityHash } from "./identity-hash";
import { getKycProvider, namesMatch } from "./kyc-provider";
import { checkDnsTxt, checkMetaTag } from "./ownership";

const { kycChecks, orgs, stores } = schema;

export type CheckType = "pan" | "gstin" | "bank" | "ownership_dns" | "ownership_meta" | "ownership_photo" | "ownership_marketplace" | "ownership_platform";
export type CheckStatus = "pending" | "passed" | "failed" | "manual_review";
export type KycCheck = typeof kycChecks.$inferSelect & { type: CheckType; status: CheckStatus };

export class VerificationError extends Error {}

export const BUSINESS_TYPES = ["individual", "proprietorship", "partnership", "company", "llp"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];
const NEEDS_GSTIN = new Set<BusinessType>(["partnership", "company", "llp"]);

async function record(row: Omit<typeof kycChecks.$inferInsert, "id">) {
  const db = await getDb();
  const [saved] = await db.insert(kycChecks).values({ id: newId("kyc"), ...row }).returning();
  return saved as KycCheck;
}

/** Another seller business already verified with this PAN or bank account? */
async function duplicateOf(orgId: string, hash: string) {
  const db = await getDb();
  const [other] = await db
    .select({ orgId: kycChecks.orgId })
    .from(kycChecks)
    .where(and(eq(kycChecks.identityHash, hash), ne(kycChecks.orgId, orgId)))
    .limit(1);
  return other?.orgId;
}

/** Legal name, business type, PAN and (for companies, LLPs and partnerships) GSTIN. */
export async function saveBusinessDetails(orgId: string, input: { legalName: string; businessType: string; pan: string; gstin?: string }) {
  const legalName = input.legalName.trim().slice(0, 120);
  const pan = input.pan.trim().toUpperCase();
  const gstin = input.gstin?.trim().toUpperCase() || undefined;
  const businessType = input.businessType as BusinessType;
  if (legalName.length < 2) throw new VerificationError("Add the legal name as on your PAN.");
  if (!BUSINESS_TYPES.includes(businessType)) throw new VerificationError("Pick your business type.");
  if (!isValidPan(pan)) throw new VerificationError("That PAN doesn't look right. It's 10 characters, like ABCDE1234F.");
  if (NEEDS_GSTIN.has(businessType) && !gstin) throw new VerificationError("Companies, LLPs and partnerships need a GSTIN.");
  if (gstin && !isValidGstin(gstin)) throw new VerificationError("That GSTIN doesn't look right. It's 15 characters, like 27ABCDE1234F1Z5.");
  if (gstin && panFromGstin(gstin) !== pan) throw new VerificationError("The PAN inside your GSTIN doesn't match the PAN you entered.");

  const db = await getDb();
  await db.update(orgs).set({ legalName, businessType }).where(eq(orgs.id, orgId));
  const provider = getKycProvider();

  const panHash = identityHash("pan", pan);
  const panResult = await provider.verifyPan(pan, legalName);
  const panDuplicate = await duplicateOf(orgId, panHash);
  const panNameOk = !panResult.nameOnRecord || namesMatch(panResult.nameOnRecord, legalName);
  const checks = [
    await record({
      orgId,
      type: "pan",
      status: panResult.status === "passed" && (!panNameOk || panDuplicate) ? "manual_review" : panResult.status,
      provider: provider.name,
      providerRef: panResult.ref,
      masked: maskPan(pan),
      identityHash: panHash,
      details: { reason: panResult.reason, nameOnRecord: panResult.nameOnRecord, nameMatches: panNameOk, duplicateOf: panDuplicate },
    }),
  ];
  if (gstin) {
    const g = await provider.verifyGstin(gstin);
    checks.push(
      await record({ orgId, type: "gstin", status: g.status, provider: provider.name, providerRef: g.ref, masked: gstin, details: { reason: g.reason, legalName: g.legalName, active: g.active } }),
    );
  }
  return checks;
}

/** Payout bank account, confirmed by penny-drop and matched to the legal name. */
export async function saveBankAccount(orgId: string, input: { holderName: string; account: string; ifsc: string }) {
  const account = input.account.replace(/\s/g, "");
  const ifsc = input.ifsc.trim().toUpperCase();
  const holderName = input.holderName.trim().slice(0, 120);
  if (holderName.length < 2) throw new VerificationError("Add the account holder's name.");
  const db = await getDb();
  const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId));
  if (!org?.legalName) throw new VerificationError("Add your business details first.");

  const provider = getKycProvider();
  const result = await provider.verifyBank(account, ifsc, holderName);
  if (result.status === "failed") throw new VerificationError(result.reason ?? "We couldn't verify that account.");
  const hash = identityHash("bank", `${ifsc}:${account}`);
  const duplicate = await duplicateOf(orgId, hash);
  const nameOk = !result.nameOnRecord || namesMatch(result.nameOnRecord, org.legalName) || namesMatch(result.nameOnRecord, holderName);
  return record({
    orgId,
    type: "bank",
    status: result.status === "passed" && (!nameOk || duplicate) ? "manual_review" : result.status,
    provider: provider.name,
    providerRef: result.ref,
    masked: `${maskAccount(account)} · ${ifsc}`,
    identityHash: hash,
    details: { reason: result.reason, nameOnRecord: result.nameOnRecord, nameMatches: nameOk, duplicateOf: duplicate, ifsc },
  });
}

/** The token the seller publishes; created on first ask. */
export async function ownershipToken(store: Store) {
  if (store.verificationToken) return store.verificationToken;
  const token = randomBytes(12).toString("hex");
  const db = await getDb();
  await db.update(stores).set({ verificationToken: token }).where(eq(stores.id, store.id));
  return token;
}

/** Check the seller's DNS record or meta tag. */
export async function checkDomainOwnership(store: Store, method: "dns" | "meta") {
  if (!store.domain) throw new VerificationError("This store has no website address.");
  const token = await ownershipToken(store);
  const ok = method === "dns" ? await checkDnsTxt(store.domain, token) : await checkMetaTag(store.domain, token);
  return record({
    orgId: store.orgId,
    storeId: store.id,
    type: method === "dns" ? "ownership_dns" : "ownership_meta",
    status: ok ? "passed" : "failed",
    provider: "ghostcart",
    masked: store.domain,
    details: { reason: ok ? undefined : method === "dns" ? "TXT record not found yet. DNS changes can take up to an hour." : "Meta tag not found on your home page." },
  });
}

/** A photo a reviewer looks at: your stock (shop-only sellers) or your marketplace seller profile. */
export async function addOwnershipPhoto(store: Store, kind: "stock" | "marketplace", url: string) {
  return record({
    orgId: store.orgId,
    storeId: store.id,
    type: kind === "stock" ? "ownership_photo" : "ownership_marketplace",
    status: "manual_review",
    provider: "manual",
    details: { url },
  });
}

export async function checksFor(store: Pick<Store, "id" | "orgId">) {
  const db = await getDb();
  const rows = (await db.select().from(kycChecks).where(eq(kycChecks.orgId, store.orgId)).orderBy(desc(kycChecks.createdAt))) as KycCheck[];
  return rows.filter((r) => !r.storeId || r.storeId === store.id);
}

/** What each platform needs to prove the seller runs the store. */
const OWNERSHIP: Record<string, CheckType[]> = {
  website: ["ownership_dns", "ownership_meta"],
  // Installing the GhostCart app or plugin from the store's own admin proves ownership.
  shopify: ["ownership_platform", "ownership_dns", "ownership_meta"],
  woocommerce: ["ownership_platform", "ownership_dns", "ownership_meta"],
  ghostcart_shop: ["ownership_photo"],
  amazon: ["ownership_marketplace"],
  flipkart: ["ownership_marketplace"],
};

export type StepState = "missing" | "failed" | "in_review" | "done";

/** The checklist the seller sees, using the latest check of each kind. */
export async function verificationChecklist(store: Store) {
  const checks = await checksFor(store);
  const latest = (types: CheckType[]) => checks.find((c) => types.includes(c.type));
  const state = (c: KycCheck | undefined): StepState => (!c ? "missing" : c.status === "passed" ? "done" : c.status === "failed" ? "failed" : "in_review");
  const db = await getDb();
  const [org] = await db.select().from(orgs).where(eq(orgs.id, store.orgId));
  const gstin = latest(["gstin"]);
  const steps = {
    business: state(latest(["pan"])),
    gstin: gstin ? state(gstin) : NEEDS_GSTIN.has(org?.businessType as BusinessType) ? ("missing" as StepState) : ("done" as StepState),
    bank: state(latest(["bank"])),
    ownership: state(latest(OWNERSHIP[store.platform] ?? [])),
  };
  const canSubmit = store.status === "draft" && Object.values(steps).every((s) => s === "done" || s === "in_review");
  const allAutomated = Object.values(steps).every((s) => s === "done");
  return { steps, canSubmit, allAutomated, org: { legalName: org?.legalName, businessType: org?.businessType }, checks };
}

export async function submitForReview(store: Store) {
  const { canSubmit } = await verificationChecklist(store);
  if (!canSubmit) throw new VerificationError("Finish the steps above first.");
  await updateStore(store.id, { status: "pending_review", reviewNote: null });
  await kv.log({ type: "seller_action", actor: "seller", detail: `${store.name} (${store.id}) submitted for review` });
}

/** Staff review queue: stores waiting for review, with their checks and any reused identity. */
export async function pendingReviews() {
  const db = await getDb();
  const waiting = (await db.select().from(stores).where(eq(stores.status, "pending_review"))) as Store[];
  if (!waiting.length) return [];
  const orgRows = await db.select().from(orgs).where(inArray(orgs.id, [...new Set(waiting.map((s) => s.orgId))]));
  return Promise.all(
    waiting.map(async (s) => {
      const { steps, allAutomated, checks } = await verificationChecklist(s);
      return { store: s, org: orgRows.find((o) => o.id === s.orgId), steps, allAutomated, checks, flags: checks.filter((c) => c.details.duplicateOf || c.details.nameMatches === false) };
    }),
  );
}

/** Approve: the store goes live at the chosen tier. Reject: back to draft with a reason the seller sees. */
export async function decideReview(storeId: string, decision: { approve: true; tier: SellerTier } | { approve: false; note: string }, reviewer: string) {
  const store = await getStore(storeId);
  if (!store || store.status !== "pending_review") throw new VerificationError("That store isn't waiting for review.");
  const db = await getDb();
  await db.update(kycChecks).set({ reviewedBy: reviewer, reviewedAt: new Date() }).where(and(eq(kycChecks.orgId, store.orgId), eq(kycChecks.status, "manual_review")));
  if (decision.approve) {
    if (!(decision.tier in TIER_LIMITS)) throw new VerificationError("Pick a tier.");
    return updateStore(storeId, { status: "live", tier: decision.tier, verifiedAt: new Date(), reviewNote: null });
  }
  if (!decision.note.trim()) throw new VerificationError("Tell the seller what to fix.");
  return updateStore(storeId, { status: "draft", reviewNote: decision.note.trim().slice(0, 500) });
}
