"use client";

import { useState } from "react";

const field = "rounded-xl border border-line bg-panel px-4 py-3 text-lg text-fg placeholder:text-muted/60 focus:border-saffron focus:outline-none disabled:opacity-60";

/** Phone login: we call the number and read out a 6-digit code, then the user types it in. */
export function PhoneLogin({ role, onDone }: { role: "buyer" | "seller" | "staff"; onDone: () => void }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function post(path: string, body: Record<string, string>) {
    setBusy(true);
    setError("");
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, role }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Something went wrong. Try again.");
      return null;
    }
    return data;
  }

  async function sendCode() {
    const data = await post("/api/auth/code", { phone });
    if (!data) return;
    setStep("code");
    setNote(
      data.via === "call"
        ? `We're calling ${data.phone} now. Pick up and we'll read out your 6-digit code.`
        : "Dev mode: the code is in the server console.",
    );
  }

  async function verify() {
    if (await post("/api/auth/verify", { phone, code })) onDone();
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (step === "phone") sendCode();
        else verify();
      }}
    >
      <label htmlFor={`${role}-login-phone`} className="text-muted">
        Mobile number
      </label>
      <input
        id={`${role}-login-phone`}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        placeholder="98765 43210"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        disabled={busy || step === "code"}
        className={field}
      />
      {step === "code" && (
        <>
          <p className="text-muted">{note}</p>
          <label htmlFor={`${role}-login-code`} className="text-muted">
            6-digit code
          </label>
          <input
            id={`${role}-login-code`}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="••••••"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            disabled={busy}
            className={`${field} font-receipt tracking-[0.4em]`}
            autoFocus
          />
        </>
      )}
      <button
        disabled={busy || (step === "phone" ? phone.replace(/\D/g, "").length < 10 : code.length !== 6)}
        className="rounded-xl bg-saffron px-6 py-3.5 text-lg font-semibold text-paper-ink disabled:opacity-50"
      >
        {busy ? "One moment…" : step === "phone" ? "Call me with a code" : "Log in"}
      </button>
      {step === "code" && (
        <button
          type="button"
          onClick={() => {
            setStep("phone");
            setCode("");
          }}
          className="text-muted underline underline-offset-4"
        >
          Use a different number or call again
        </button>
      )}
      {error && (
        <p role="alert" className="text-alarm">
          {error}
        </p>
      )}
    </form>
  );
}
