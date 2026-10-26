import { afterEach, describe, expect, it } from "vitest";
import { rateLimit } from "./rate-limit";

const limit = (id: string) => ({ name: `zz-allow-${Math.random()}`, id, max: 1, windowSeconds: 60 });

afterEach(() => {
  delete process.env.RATE_LIMIT_ALLOWLIST;
  delete process.env.VERCEL_ENV;
});

describe("rate limit allowlist", () => {
  it("lets a load generator's IP through on staging only", async () => {
    const l = limit("203.0.113.7");
    expect(await rateLimit(l)).toBeNull();
    expect((await rateLimit(l))?.status).toBe(429);

    process.env.RATE_LIMIT_ALLOWLIST = "198.51.100.1, 203.0.113.7";
    expect(await rateLimit(l)).toBeNull();

    process.env.VERCEL_ENV = "production";
    expect((await rateLimit(l))?.status).toBe(429);
  });
});
