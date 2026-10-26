import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhook } from "./pinelabs";

const secret = Buffer.from("zz-test-webhook-secret").toString("base64");
const sign = (id: string, ts: string, body: string) => `v1,${createHmac("sha256", Buffer.from(secret, "base64")).update(`${id}.${ts}.${body}`).digest("base64")}`;

describe("Pine Labs webhooks", () => {
  it("accept the signed body, inside the time window, and nothing else", () => {
    const now = Date.parse("2026-10-26T10:00:00Z");
    const ts = String(now / 1000);
    const body = '{"event":"ORDER_PROCESSED"}';
    const h = { id: "msg_1", timestamp: ts, signature: `v1,bogus ${sign("msg_1", ts, body)}` };
    expect(verifyWebhook(h, body, secret, 300, now)).toBe(true);
    expect(verifyWebhook(h, body.replace("PROCESSED", "FAILED"), secret, 300, now)).toBe(false);
    expect(verifyWebhook(h, body, secret, 300, now + 10 * 60 * 1000)).toBe(false);
    expect(verifyWebhook({ ...h, signature: null }, body, secret, 300, now)).toBe(false);
  });
});
