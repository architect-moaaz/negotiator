import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as code } from "@/app/api/auth/code/route";
import { verifyTurnstile } from "./turnstile";

const req = (body: unknown) => new Request("http://x/api/auth/code", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 250)}` }, body: JSON.stringify(body) });

afterEach(() => {
  delete process.env.TURNSTILE_SECRET_KEY;
  vi.restoreAllMocks();
});

describe("turnstile", () => {
  it("passes everything while switched off", async () => {
    expect(await verifyTurnstile(undefined, req({}))).toBe(true);
  });

  it("asks Cloudflare once on, and fails closed when it can't", async () => {
    process.env.TURNSTILE_SECRET_KEY = "zz-secret";
    const real = globalThis.fetch;
    const seen: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (!url.includes("siteverify")) return real(input, init);
      const form = new URLSearchParams(String(init?.body));
      seen.push(form.get("response")!);
      if (form.get("response") === "down") throw new TypeError("unreachable");
      return Response.json({ success: form.get("response") === "good-token" && form.get("secret") === "zz-secret" });
    });
    expect(await verifyTurnstile("good-token", req({}))).toBe(true);
    expect(await verifyTurnstile("forged", req({}))).toBe(false);
    expect(await verifyTurnstile("down", req({}))).toBe(false);
    expect(await verifyTurnstile("", req({}))).toBe(false);
    expect(seen).toEqual(["good-token", "forged", "down"]);

    // The login-code route refuses without a passing token, before placing any call.
    const refused = await code(req({ role: "member", phone: "9000009901" }));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ turnstile: true });
    const ok = await code(req({ role: "member", phone: "9000009902", turnstile: "good-token" }));
    expect(ok.status).toBe(200);
  });
});
