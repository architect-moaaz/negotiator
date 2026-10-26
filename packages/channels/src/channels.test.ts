import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { isShopDomain, verifyMetaSignature, verifyWebhookHmac } from "./index";

afterEach(() => {
  delete process.env.META_APP_SECRET;
});

describe("channel signatures", () => {
  it("check Meta's X-Hub-Signature-256 and Shopify's webhook HMAC over the raw body", () => {
    process.env.META_APP_SECRET = "zz-meta";
    const body = '{"object":"whatsapp_business_account"}';
    const meta = `sha256=${createHmac("sha256", "zz-meta").update(body).digest("hex")}`;
    expect(verifyMetaSignature(body, meta)).toBe(true);
    expect(verifyMetaSignature(`${body} `, meta)).toBe(false);
    const shopify = createHmac("sha256", "zz-shopify").update(body).digest("base64");
    expect(verifyWebhookHmac(body, shopify, "zz-shopify")).toBe(true);
    expect(verifyWebhookHmac(body, shopify, "other")).toBe(false);
    expect(isShopDomain("zz-test.myshopify.com")).toBe(true);
    expect(isShopDomain("evil.com/zz.myshopify.com")).toBe(false);
  });
});
