import { isValidAccountNumber, isValidGstin, isValidIfsc, isValidPan } from "@ghostcart/core";

/**
 * Identity and bank checks. A contracted KYC provider (IDfy, Signzy, Karza class) plugs in behind this
 * interface; until one is contracted, production uses "manual", which sends every check to a
 * reviewer with the seller's documents. "sandbox" is for development and tests only.
 */
export type KycStatus = "passed" | "failed" | "manual_review";
export interface KycResult {
  status: KycStatus;
  /** Name on the government or bank record, for the name match. */
  nameOnRecord?: string;
  ref?: string;
  reason?: string;
}

export interface KycProvider {
  name: string;
  verifyPan(pan: string, claimedName: string): Promise<KycResult>;
  verifyGstin(gstin: string): Promise<KycResult & { legalName?: string; active?: boolean }>;
  /** Penny-drop: a ₹1 credit that returns the account holder's name. */
  verifyBank(account: string, ifsc: string, claimedName: string): Promise<KycResult>;
}

const manual: KycProvider = {
  name: "manual",
  async verifyPan() {
    return { status: "manual_review", reason: "A reviewer checks this against your documents." };
  },
  async verifyGstin() {
    return { status: "manual_review", reason: "A reviewer checks this on the GST portal." };
  },
  async verifyBank() {
    return { status: "manual_review", reason: "A reviewer checks this against your cancelled cheque or statement." };
  },
};

/**
 * Deterministic stand-in: well-formed numbers pass and echo the claimed name back, except the test
 * values below, so every branch can be exercised without a provider account.
 * PAN "ZZZPZ9999Z" → failed; GSTIN with PAN ZZZPZ9999Z → inactive; account ending 0000 → name mismatch.
 */
const sandbox: KycProvider = {
  name: "sandbox",
  async verifyPan(pan, claimedName) {
    if (!isValidPan(pan)) return { status: "failed", reason: "That isn't a valid PAN." };
    if (pan.toUpperCase() === "ZZZPZ9999Z") return { status: "failed", reason: "No PAN record found." };
    return { status: "passed", nameOnRecord: claimedName, ref: `sbx-pan-${pan.slice(-4)}` };
  },
  async verifyGstin(gstin) {
    if (!isValidGstin(gstin)) return { status: "failed", reason: "That isn't a valid GSTIN." };
    if (gstin.toUpperCase().slice(2, 12) === "ZZZPZ9999Z") return { status: "failed", active: false, reason: "This GSTIN is cancelled." };
    return { status: "passed", active: true, ref: `sbx-gst-${gstin.slice(-4)}` };
  },
  async verifyBank(account, ifsc, claimedName) {
    if (!isValidAccountNumber(account) || !isValidIfsc(ifsc)) return { status: "failed", reason: "Check the account number and IFSC." };
    if (account.endsWith("0000")) return { status: "passed", nameOnRecord: "SOMEONE ELSE", ref: `sbx-bank-${account.slice(-4)}` };
    return { status: "passed", nameOnRecord: claimedName.toUpperCase(), ref: `sbx-bank-${account.slice(-4)}` };
  },
};

export function getKycProvider(): KycProvider {
  const chosen = process.env.KYC_PROVIDER ?? (process.env.VERCEL_ENV === "production" ? "manual" : "sandbox");
  if (chosen === "sandbox" && process.env.VERCEL_ENV === "production") return manual; // never let fake checks pass in production
  return chosen === "sandbox" ? sandbox : manual;
}

/**
 * Do two names refer to the same person or business? Ignores case, punctuation, honorifics and
 * company suffixes, and accepts initials ("R K Sharma" ~ "Ravi Kumar Sharma").
 */
export function namesMatch(a: string, b: string) {
  const NOISE = new Set(["mr", "mrs", "ms", "dr", "shri", "smt", "m/s", "ms.", "private", "pvt", "limited", "ltd", "llp", "and", "&", "co", "the"]);
  const tokens = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t && !NOISE.has(t));
  const x = tokens(a);
  const y = tokens(b);
  if (!x.length || !y.length) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.every((t) => long.some((u) => u === t || (t.length === 1 && u.startsWith(t)) || (u.length === 1 && t.startsWith(u))));
}
