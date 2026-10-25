import { describe, expect, it } from "vitest";
import { verifyWebhook } from "./pinelabs";

// Worked example from Pine Labs' webhook signature verification docs.
const headers = {
  id: "msg_2nEfCaUDn9fynC9Kz2upo1QSydl",
  timestamp: "1728543028",
  signature: "v1,Ns46HrH+Nfu9dZtBUVvSLyrOD5JH0SAGlNo3M5yobfQ=",
};
const body = '{"payload":"payload"}';
const secret = "YWJjMTIzNA==";
const now = 1728543028 * 1000;

describe("verifyWebhook", () => {
  it("accepts the documented signature", () => {
    expect(verifyWebhook(headers, body, secret, 300, now)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyWebhook(headers, '{"payload":"evil"}', secret, 300, now)).toBe(false);
  });

  it("rejects stale timestamps", () => {
    expect(verifyWebhook(headers, body, secret, 300, now + 3600_000)).toBe(false);
  });
});
