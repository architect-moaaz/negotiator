"use client";

import { useEffect, useRef, useState } from "react";
import { api, ErrorText, secondary } from "./ui";

declare global {
  interface Window {
    FB?: { init(o: Record<string, unknown>): void; login(cb: (r: { authResponse?: { code?: string } }) => void, o: Record<string, unknown>): void };
    fbAsyncInit?: () => void;
  }
}

const APP_ID = process.env.NEXT_PUBLIC_META_APP_ID;
const CONFIG_ID = process.env.NEXT_PUBLIC_META_WA_CONFIG_ID;
const DEV_MOCK = process.env.NEXT_PUBLIC_META_DEV_MOCK === "1";

/** Seller connects their own WhatsApp Business number through Meta's Embedded Signup. */
export function WhatsAppConnect({ storeId, onConnected }: { storeId: string; onConnected: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Latest Embedded Signup result; read when the login callback fires.
  const signup = useRef<{ phoneNumberId?: string; wabaId?: string }>({});

  useEffect(() => {
    if (!APP_ID || window.FB) return;
    window.fbAsyncInit = () => window.FB!.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: false, version: "v24.0" });
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.async = true;
    s.crossOrigin = "anonymous";
    document.body.append(s);
    // Embedded Signup reports the chosen number and WhatsApp Business Account in a window message.
    const onMessage = (e: MessageEvent) => {
      if (!/(^|\.)facebook\.com$/.test(new URL(e.origin).hostname)) return;
      try {
        const data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (data?.type === "WA_EMBEDDED_SIGNUP" && data.event === "FINISH") signup.current = { phoneNumberId: data.data?.phone_number_id, wabaId: data.data?.waba_id };
      } catch {
        // not ours
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function finish(code: string, phoneNumberId: string, wabaId: string) {
    setBusy(true);
    const r = await api(`/api/seller/connect/whatsapp`, { body: { storeId, code, phoneNumberId, wabaId } });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onConnected();
  }

  function start() {
    setError("");
    if (!window.FB || !CONFIG_ID) return setError("WhatsApp signup isn't available yet. Try again in a moment.");
    window.FB.login(
      (res) => {
        const code = res.authResponse?.code;
        // The FINISH message usually arrives just before the login callback.
        setTimeout(() => {
          const s = signup.current;
          if (code && s.phoneNumberId && s.wabaId) finish(code, s.phoneNumberId, s.wabaId);
          else if (code) setError("Signup finished without a WhatsApp number. Try again and pick a number.");
        }, 500);
      },
      { config_id: CONFIG_ID, response_type: "code", override_default_response_type: true, extras: { setup: {}, featureType: "", sessionInfoVersion: "3" } },
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      {APP_ID && CONFIG_ID && (
        <button onClick={start} disabled={busy} className={secondary}>
          {busy ? "Connecting…" : "Connect WhatsApp"}
        </button>
      )}
      {DEV_MOCK && (
        <button onClick={() => finish("mock-code", "1099000000001", "2099000000001")} disabled={busy} className={secondary}>
          Connect a test number (development)
        </button>
      )}
      {!APP_ID && !DEV_MOCK && <p className="text-sm text-muted">WhatsApp connection opens once GhostCart&apos;s Meta business verification completes.</p>}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
