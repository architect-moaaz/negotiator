/**
 * Response headers for every page and API route. Kept out of next.config.ts so they can be tested.
 *
 * The CSP can't use nonces: Cache Components prerenders static shells whose inline scripts can't carry a
 * per-request nonce, so script-src allows 'unsafe-inline' for Next's own inline bootstrapping. What the
 * policy still enforces: scripts only from us (plus Meta's SDK for WhatsApp Embedded Signup), no plugins,
 * no <base> hijacking, forms post only to us, nobody can frame our pages, and fetches stay on our origin.
 */
export function contentSecurityPolicy(dev = process.env.NODE_ENV === "development") {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", "https://connect.facebook.net", "https://challenges.cloudflare.com", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    // Product photos come from sellers' own hosts (Shopify CDN, Vercel Blob, marketplaces); UPI QR codes are data: URLs.
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "font-src": ["'self'"],
    // Meta for WhatsApp signup; Turnstile; Sentry's ingest for browser error reports (only sent when configured).
    "connect-src": ["'self'", "https://*.facebook.com", "https://connect.facebook.net", "https://challenges.cloudflare.com", "https://*.ingest.sentry.io", "https://*.ingest.de.sentry.io", ...(dev ? ["ws:"] : [])],
    // Embedded Signup opens Meta's dialog in a frame; Turnstile's check runs in one.
    "frame-src": ["https://www.facebook.com", "https://web.facebook.com", "https://challenges.cloudflare.com"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    // The hosted payment page redirects back to us; nothing else should receive a form post.
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    ...(dev ? {} : { "upgrade-insecure-requests": [] }),
  };
  return Object.entries(directives)
    .map(([k, v]) => [k, ...v].join(" "))
    .join("; ");
}

export function securityHeaders(dev = process.env.NODE_ENV === "development") {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(dev) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Sellers take product photos through a file input (no camera permission needed); nothing else asks.
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
    // Keeps window.opener away from pages we open, except Meta's signup popup which needs to message back.
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
  ];
}
