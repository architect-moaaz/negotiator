/**
 * Transactional email through Resend's HTTP API (RESEND_API_KEY, EMAIL_FROM). Without a key, development
 * and tests keep messages in an in-process outbox instead of sending; production refuses, so nothing is
 * silently dropped.
 */
export interface Email {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** One-click unsubscribe (RFC 8058), shown by mail apps next to the sender. */
  unsubscribeUrl?: string;
}

export class EmailError extends Error {}

const g = globalThis as typeof globalThis & { __ghostcartOutbox?: (Email & { at: number })[] };
/** Messages "sent" without a provider (development and tests only). */
export const outbox = (g.__ghostcartOutbox ??= []);

export const emailConfigured = () => !!process.env.RESEND_API_KEY || process.env.VERCEL_ENV !== "production";

export async function sendEmail(email: Email) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.VERCEL_ENV === "production") throw new EmailError("Email isn't set up: add RESEND_API_KEY.");
    outbox.push({ ...email, at: Date.now() });
    return { id: `outbox_${outbox.length}` };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "GhostCart <offers@ghostcart.app>",
      to: [email.to],
      subject: email.subject,
      text: email.text,
      html: email.html,
      headers: email.unsubscribeUrl ? { "List-Unsubscribe": `<${email.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new EmailError(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as { id: string };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain, readable HTML from paragraphs and one button; no tracking pixels. */
export function simpleHtml(paragraphs: string[], button?: { label: string; url: string }, footer?: string) {
  const p = paragraphs.map((t) => `<p style="margin:0 0 14px">${esc(t)}</p>`).join("");
  const b = button
    ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="background:#f4b740;color:#1c1a26;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:600">${esc(button.label)}</a></p>`
    : "";
  const f = footer ? `<p style="margin:28px 0 0;color:#777;font-size:13px">${esc(footer)}</p>` : "";
  return `<div style="font:15px/1.5 system-ui,-apple-system,sans-serif;color:#1c1a26;max-width:560px">${p}${b}${f}</div>`;
}
