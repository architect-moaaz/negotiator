/** ₹1,23,456 (Indian digit grouping), whole rupees. */
export const inr = (rupees: number) => `₹${Math.round(rupees).toLocaleString("en-IN")}`;

/** "+91 98765 43210" → "9876543210"; null if it isn't an Indian mobile number. */
export function tenDigits(raw: string) {
  const d = raw.replace(/\D/g, "");
  const local = d.length === 12 && d.startsWith("91") ? d.slice(2) : d.length === 11 && d.startsWith("0") ? d.slice(1) : d;
  return /^[6-9]\d{9}$/.test(local) ? local : null;
}

/** "3:05" from milliseconds left. */
export function clock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
