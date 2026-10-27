"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { t, type Lang } from "@/lib/i18n";
import { Turnstile, turnstileRequired } from "./turnstile";

const field = "rounded-xl border border-line bg-panel px-4 py-3 text-fg placeholder:text-muted/60 focus:border-saffron focus:outline-none disabled:opacity-60";

/** Shopper signup with the phone code (same two steps as /api/signup). Calls onDone once signed in. */
export function ShopperSignup({ onDone, lang = "en" }: { onDone: () => void; lang?: Lang }) {
  const [form, setForm] = useState({ name: "", phone: "", consent: false, code: "" });
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState("");
  const [captchaReset, setCaptchaReset] = useState(0);
  const onToken = useCallback((t: string) => setCaptcha(t), []);

  async function submit() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, phone: form.phone, consent: form.consent, lang, code: note ? form.code : undefined, source: "shop", turnstile: note ? undefined : captcha }),
    });
    if (!note) {
      setCaptcha("");
      setCaptchaReset((n) => n + 1);
    }
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error || t(lang, "signup.failed"));
    if (data.codeSent) return setNote(data.via === "call" ? t(lang, "signup.calling", { phone: data.phone }) : "Dev mode: the code is in the server console.");
    onDone();
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p className="font-semibold">{t(lang, "signup.title")}</p>
      <p className="-mt-2 text-sm text-muted">
        {t(lang, "signup.before")}{" "}
        <Link href="/login" className="text-fg underline underline-offset-4">
          {t(lang, "signup.login")}
        </Link>
      </p>
      <label className="grid gap-2">
        <span className="text-muted">{t(lang, "signup.name")}</span>
        <input required autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={busy} className={field} />
      </label>
      <label className="grid gap-2">
        <span className="text-muted">{t(lang, "signup.phone")}</span>
        <input
          required
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="98765 43210"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          disabled={busy || !!note}
          className={field}
        />
      </label>
      <label className="flex items-start gap-3 text-sm text-muted">
        <input type="checkbox" required checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} className="mt-0.5 size-4 accent-saffron" />
        <span>{t(lang, "signup.consent")}</span>
      </label>
      {note && (
        <label className="grid gap-2">
          <span className="text-muted">{note}</span>
          <input
            required
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="••••••"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, "") })}
            className={`${field} font-receipt tracking-[0.4em]`}
          />
        </label>
      )}
      {error && (
        <p role="alert" className="text-alarm">
          {error}
        </p>
      )}
      {!note && <Turnstile onToken={onToken} resetKey={captchaReset} />}
      <button disabled={busy || (!!note && form.code.length !== 6) || (!note && turnstileRequired && !captcha)} className="rounded-xl bg-saffron px-6 py-3.5 text-lg font-semibold text-paper-ink disabled:opacity-50">
        {busy ? t(lang, "signup.wait") : note ? t(lang, "signup.verify") : t(lang, "signup.call")}
      </button>
    </form>
  );
}
