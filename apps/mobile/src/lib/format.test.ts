import { describe, expect, it } from "vitest";
import { request, sessionHeaders } from "./api";
import { clock, inr, tenDigits } from "./format";

describe("format", () => {
  it("formats rupees, phone numbers and the countdown", () => {
    expect(inr(123456)).toBe("₹1,23,456");
    expect(tenDigits("+91 98765 43210")).toBe("9876543210");
    expect(tenDigits("098765 43210")).toBe("9876543210");
    expect(tenDigits("12345")).toBeNull();
    expect(clock(185_000)).toBe("3:05");
    expect(clock(-5)).toBe("0:00");
  });
});

describe("api", () => {
  it("sends the session headers and turns errors into messages", async () => {
    expect(sessionHeaders({ buyer: "b", member: "m" })).toEqual({ "x-gc-buyer": "b", "x-gc-member": "m" });
    let seen: RequestInit | undefined;
    const fake = (async (_url: string, init?: RequestInit) => {
      seen = init;
      return new Response(JSON.stringify({ error: "Deal not found." }), { status: 404 });
    }) as typeof fetch;
    const r = await request({ buyer: "tok" }, "/api/deal?id=x", {}, fake);
    expect(r).toEqual({ ok: false, status: 404, error: "Deal not found." });
    expect((seen?.headers as Record<string, string>)["x-gc-buyer"]).toBe("tok");
    const offline = await request({}, "/x", { body: { a: 1 } }, (async () => {
      throw new TypeError("network");
    }) as typeof fetch);
    expect(offline).toMatchObject({ ok: false, status: 0 });
  });
});
