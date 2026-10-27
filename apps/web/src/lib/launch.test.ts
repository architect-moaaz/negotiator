import { describe, expect, it } from "vitest";
import { launchProblems } from "./launch";

const ready = {
  DATABASE_URL: "postgres://x",
  STORE_MODE: "redis",
  CRON_SECRET: "x",
  STAFF: "9000000001:owner:ZZ Owner",
  NEXT_PUBLIC_APP_URL: "https://ghostcart.app",
  KV_REST_API_URL: "https://x",
  KV_REST_API_TOKEN: "x",
  ANTHROPIC_API_KEY: "x",
  SECRETS_KEYS: "k1:x",
  PINELABS_MODE: "live",
  RESEND_API_KEY: "x",
  SHIPROCKET_EMAIL: "x",
  SENTRY_DSN: "x",
  TURNSTILE_SECRET_KEY: "x",
  WHATSAPP_ORDER_TEMPLATE: "x",
};

describe("launch preflight", () => {
  it("passes a complete production setup", () => {
    expect(launchProblems(ready)).toEqual([]);
  });
  it("blocks on what the hackathon production lacks, and flags test modes and leftovers", () => {
    const p = launchProblems({ NEXT_PUBLIC_APP_URL: "https://ghostcart-topaz.vercel.app", KV_REST_API_URL: "x", KV_REST_API_TOKEN: "x", ANTHROPIC_API_KEY: "x", PINELABS_MODE: "mock", DEMO_SIMULATE: "1" });
    expect(p.filter((x) => x.level === "blocker").map((x) => x.key)).toEqual(["DATABASE_URL", "STORE_MODE", "CRON_SECRET", "STAFF", "SECRETS_KEYS"]);
    expect(p.map((x) => x.key)).toEqual(expect.arrayContaining(["PINELABS_MODE", "DEMO_SIMULATE", "RESEND_API_KEY"]));
  });
  it("checks values that would break quietly", () => {
    const keys = launchProblems({ ...ready, STORE_MODE: "mongo", STAFF: "9000000001:admin:ZZ", NEXT_PUBLIC_APP_URL: "http://x" }).map((x) => x.key);
    expect(keys).toEqual(["STORE_MODE", "STAFF", "NEXT_PUBLIC_APP_URL"]);
  });
});
