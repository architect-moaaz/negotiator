import { afterEach, describe, expect, it, vi } from "vitest";
import { log, traced, track } from "./telemetry";

afterEach(() => vi.restoreAllMocks());

describe("telemetry", () => {
  it("passes results and errors through spans unchanged", async () => {
    expect(await traced("zz.ok", { a: 1 }, async () => 42)).toBe(42);
    await expect(traced("zz.fail", {}, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  });

  it("logs one JSON object per line", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    log("error", "pine labs timeout", { dealId: "d1", ms: 3000 });
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ level: "error", msg: "pine labs timeout", dealId: "d1", ms: 3000 });
    expect(typeof line.ts).toBe("string");
  });

  it("does nothing without a PostHog key", async () => {
    delete process.env.POSTHOG_KEY;
    await expect(track("negotiation_started", "u1", { channel: "web" })).resolves.toBeUndefined();
  });
});
