"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** Sends one anonymous page-view per path per browser session. */
export function VisitTracker() {
  const path = usePathname();
  useEffect(() => {
    if (!path || path.startsWith("/admin") || path.startsWith("/api")) return;
    // An invite link (?invite=CODE): remembered for 30 days so a later sign-up is credited to the inviter.
    const invite = new URLSearchParams(location.search).get("invite");
    if (invite && /^[A-Za-z2-9]{8}$/.test(invite)) document.cookie = `gc_invite=${invite.toUpperCase()}; path=/; max-age=2592000; samesite=lax`;
    try {
      const k = `gc_seen:${path}`;
      if (sessionStorage.getItem(k)) return;
      sessionStorage.setItem(k, "1");
    } catch {}
    const q = new URLSearchParams(location.search);
    fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, referrer: document.referrer || undefined, source: q.get("ref") || q.get("utm_source") || undefined }),
      keepalive: true,
    }).catch(() => {});
  }, [path]);
  return null;
}
