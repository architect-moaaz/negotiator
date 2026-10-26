"use client";

import { useEffect, useState } from "react";
import { api, secondary } from "./ui";

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

type State = "unsupported" | "off" | "on" | "blocked" | "busy";

/** Lets a seller get an offer notification in this browser, even with the dashboard closed. */
export function BrowserNotifications() {
  const [state, setState] = useState<State>("busy");
  const [error, setError] = useState("");

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!VAPID || !("serviceWorker" in navigator) || !("PushManager" in window)) return setState("unsupported");
      if (Notification.permission === "denied") return setState("blocked");
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      setState((await reg?.pushManager.getSubscription()) ? "on" : "off");
    }, 0);
    return () => clearTimeout(t);
  }, []);

  async function turnOn() {
    setError("");
    setState("busy");
    try {
      if ((await Notification.requestPermission()) !== "granted") return setState("blocked");
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID!) }));
      const r = await api("/api/push/web", { body: sub.toJSON() });
      if (!r.ok) throw new Error(r.error);
      setState("on");
    } catch (err) {
      setError((err as Error).message || "Couldn't turn on notifications in this browser.");
      setState("off");
    }
  }

  async function turnOff() {
    setState("busy");
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await api("/api/push/web", { method: "DELETE", body: { endpoint: sub.endpoint } });
      await sub.unsubscribe();
    }
    setState("off");
  }

  if (state === "unsupported") return null;
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-4 py-3">
      <p className="text-sm text-muted">
        {state === "on"
          ? "This browser gets a notification for each offer that needs you."
          : state === "blocked"
            ? "Notifications are blocked for GhostCart in this browser's settings."
            : "Get a notification in this browser when an offer needs you, even with this page closed."}
      </p>
      {state === "on" ? (
        <button onClick={turnOff} className={secondary}>
          Turn off
        </button>
      ) : state !== "blocked" ? (
        <button onClick={turnOn} disabled={state === "busy"} className={secondary}>
          {state === "busy" ? "One moment…" : "Notify me in this browser"}
        </button>
      ) : null}
      {error && <p className="w-full text-sm text-alarm">{error}</p>}
    </div>
  );
}
