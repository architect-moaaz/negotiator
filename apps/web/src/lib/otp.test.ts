import { afterEach, describe, expect, it, vi } from "vitest";
import { sendLoginCode, verifyLoginCode } from "./otp";

let n = 0;
const phone = () => `+9190000231${String(++n).padStart(2, "0")}`;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("E2E_LOGIN_CODE (device tests)", () => {
  it("fixes the code in local development, so Maestro flows can sign in", async () => {
    vi.stubEnv("E2E_LOGIN_CODE", "123456");
    const p = phone();
    await sendLoginCode("buyer", p);
    await expect(verifyLoginCode("buyer", p, "123456")).resolves.toBeUndefined();
  });

  it("is ignored in production builds and on Vercel, and when it isn't six digits", async () => {
    for (const env of [{ NODE_ENV: "production" }, { VERCEL_ENV: "preview" }, { E2E_LOGIN_CODE: "12345" }]) {
      vi.unstubAllEnvs();
      vi.stubEnv("E2E_LOGIN_CODE", "123456");
      for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
      const p = phone();
      // In production without Vobiz there's no code at all; elsewhere it's random, so 123456 won't do.
      const sent = await sendLoginCode("buyer", p).catch((e: Error) => e);
      if (sent instanceof Error) {
        expect(sent.message).toContain("isn't available");
        continue;
      }
      await expect(verifyLoginCode("buyer", p, "123456")).rejects.toThrow();
    }
  });
});
