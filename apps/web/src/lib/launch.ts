/**
 * Launch preflight (docs/launch.md): which production settings are missing or unsafe. Read-only; looks
 * at names and a few values that mark test modes, never prints a secret.
 */
export interface LaunchProblem {
  level: "blocker" | "warning";
  key: string;
  why: string;
}

const REQUIRED: [string, string][] = [
  ["DATABASE_URL", "Postgres (Neon) for sellers, orders, the ledger and carts"],
  ["STORE_MODE", "which store holds durable data (redis → dual → postgres, docs/database.md)"],
  ["CRON_SECRET", "every scheduled job answers 401 without it"],
  ["STAFF", "the admin roster (phone:role:name), which replaced ADMIN_TOKEN"],
  ["NEXT_PUBLIC_APP_URL", "links in messages, voice callbacks and widget redirects"],
  ["KV_REST_API_URL", "Redis for sessions, login codes and rate limits"],
  ["KV_REST_API_TOKEN", "Redis for sessions, login codes and rate limits"],
  ["ANTHROPIC_API_KEY", "the agent's wording and reading shoppers' messages"],
];

const RECOMMENDED: [string, string][] = [
  ["RESEND_API_KEY", "email (order updates, Privilege invites) is refused in production without it"],
  ["SHIPROCKET_EMAIL", "courier tracking and pickups; without it delivery needs the buyer's code or tap"],
  ["SENTRY_DSN", "errors from production go nowhere without it"],
  ["TURNSTILE_SECRET_KEY", "bot check in front of login-code calls"],
  ["WHATSAPP_ORDER_TEMPLATE", "order updates on WhatsApp"],
];

export function launchProblems(env: Record<string, string | undefined>): LaunchProblem[] {
  const out: LaunchProblem[] = [];
  const has = (k: string) => !!env[k]?.trim();
  for (const [key, why] of REQUIRED) if (!has(key)) out.push({ level: "blocker", key, why });
  if (!has("SECRETS_KEYS") && !has("SECRETS_KEY")) out.push({ level: "blocker", key: "SECRETS_KEYS", why: "encrypts stored Shopify, Woo and WhatsApp tokens" });
  if (has("STORE_MODE") && !["redis", "dual", "postgres"].includes(env.STORE_MODE!)) out.push({ level: "blocker", key: "STORE_MODE", why: "must be redis, dual or postgres" });
  if (has("STAFF") && !env.STAFF!.split(",").some((s) => /:owner:/.test(s))) out.push({ level: "blocker", key: "STAFF", why: "needs at least one owner (phone:owner:name)" });
  if (has("NEXT_PUBLIC_APP_URL") && !/^https:\/\//.test(env.NEXT_PUBLIC_APP_URL!)) out.push({ level: "blocker", key: "NEXT_PUBLIC_APP_URL", why: "must be the https address shoppers use" });
  if (env.PINELABS_MODE !== "live") out.push({ level: "warning", key: "PINELABS_MODE", why: "payments are in test mode; shoppers see test-mode labels and no money moves" });
  if (env.ALLOW_TEST_PAYMENTS === "1") out.push({ level: "warning", key: "ALLOW_TEST_PAYMENTS", why: "the test gateway is switched on in production" });
  for (const old of ["DEMO_SIMULATE", "FIRECRAWL_API_KEY"]) if (has(old)) out.push({ level: "warning", key: old, why: "hackathon setting the product no longer uses; remove it" });
  for (const [key, why] of RECOMMENDED) if (!has(key)) out.push({ level: "warning", key, why });
  return out;
}
