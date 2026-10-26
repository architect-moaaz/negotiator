/**
 * Format checks for Indian business identifiers. These prove a number is well-formed, not that it
 * belongs to the seller; ownership is checked by the KYC provider or a reviewer.
 */

/** PAN: 5 letters, 4 digits, 1 letter; the 4th letter is the holder type (P person, C company, F firm…). */
export function isValidPan(pan: string) {
  return /^[A-Z]{3}[ABCFGHJLPT][A-Z]\d{4}[A-Z]$/.test(pan.toUpperCase());
}

export const panHolderType = (pan: string) =>
  ({ P: "individual", C: "company", F: "firm", H: "huf", A: "aop", T: "trust", B: "boi", L: "local_authority", J: "artificial_person", G: "government" })[pan.toUpperCase()[3]] ?? "unknown";

const GST_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** GSTIN: 2-digit state code + PAN + entity number + 'Z' + a base-36 check character. */
export function isValidGstin(gstin: string) {
  const g = gstin.toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return false;
  const state = Number(g.slice(0, 2));
  if (state < 1 || (state > 38 && state !== 97 && state !== 99)) return false;
  return gstinCheckChar(g.slice(0, 14)) === g[14];
}

/** The GSTN check character: weighted base-36 sum over the first 14 characters. */
export function gstinCheckChar(first14: string) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GST_CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GST_CHARS[(36 - (sum % 36)) % 36];
}

/** The PAN embedded in a GSTIN (characters 3–12). */
export const panFromGstin = (gstin: string) => gstin.toUpperCase().slice(2, 12);

/** IFSC: 4-letter bank code, a 0, then 6 branch characters. */
export function isValidIfsc(ifsc: string) {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.toUpperCase());
}

/** Bank account numbers in India are 9–18 digits. */
export function isValidAccountNumber(account: string) {
  return /^\d{9,18}$/.test(account);
}

/** "ABCDE1234F" → "ABC•••••4F"; account "123456789012" → "••••••••9012". For display and logs only. */
export const maskPan = (pan: string) => `${pan.slice(0, 3)}${"•".repeat(5)}${pan.slice(8)}`;
export const maskAccount = (account: string) => `${"•".repeat(Math.max(0, account.length - 4))}${account.slice(-4)}`;
