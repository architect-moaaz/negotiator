"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => string; reset: (id?: string) => void; remove: (id: string) => void };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * Cloudflare's bot check (usually invisible to people). Renders nothing when no site key is set. Calls
 * onToken with a fresh token, and with "" when it expires so the form asks again.
 */
export function Turnstile({ onToken, resetKey = 0 }: { onToken: (token: string) => void; resetKey?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!SITE_KEY || !box.current) return;
    let cancelled = false;
    const mount = () => {
      if (cancelled || !box.current || !window.turnstile || widget.current) return;
      widget.current = window.turnstile.render(box.current, { sitekey: SITE_KEY, theme: "dark", callback: onToken, "expired-callback": () => onToken(""), "error-callback": () => onToken("") });
    };
    if (!document.querySelector(`script[src="${SRC}"]`)) {
      const s = document.createElement("script");
      s.src = SRC;
      s.async = true;
      document.head.append(s);
    }
    // Poll rather than listen for "load": the script may already have loaded (another form, a remount).
    const poll = setInterval(() => {
      if (window.turnstile) {
        clearInterval(poll);
        mount();
      }
    }, 100);
    return () => {
      cancelled = true;
      clearInterval(poll);
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = undefined;
    };
  }, [onToken]);

  // A used token can't be reused: the form bumps resetKey after each attempt.
  useEffect(() => {
    if (resetKey && widget.current) window.turnstile?.reset(widget.current);
  }, [resetKey]);

  if (!SITE_KEY) return null;
  return <div ref={box} className="min-h-[65px]" />;
}

export const turnstileRequired = !!SITE_KEY;
