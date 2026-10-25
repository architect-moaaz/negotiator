"use client";

import { PhoneLogin } from "./phone-login";

/** Gate for staff pages: phone-code login against the staff list. */
export function StaffLogin({ title, error, onDone }: { title: string; error?: string; onDone: () => void }) {
  return (
    <div className="mx-auto mt-24 flex w-full max-w-sm flex-col gap-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted">Staff only. Log in with the number on the GhostCart staff list.</p>
      {error && (
        <p role="alert" className="text-alarm">
          {error}
        </p>
      )}
      <PhoneLogin role="staff" onDone={onDone} />
    </div>
  );
}

export async function staffLogout() {
  await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "staff" }) });
}
