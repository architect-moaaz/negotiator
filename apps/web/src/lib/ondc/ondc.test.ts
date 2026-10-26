import { createCipheriv, diffieHellman, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { confirm, init, initResult, orderState, search, searchResults, select, selectResult, transactionOwner } from "./buyer";
import { authorizationHeader, blake512, decryptChallenge, generateSigningKeys, parseAuthorization, verifyAuthorization } from "./crypto";
import { receiveCallback } from "./inbound";

const delivery = { name: "ZZ Buyer", phone: "9000006001", building: "12 ZZ Residency", locality: "Indiranagar", city: "Bengaluru", state: "Karnataka", pincode: "560038" };

describe("ONDC signing", () => {
  const key = { subscriberId: "zz-bap.test", ukId: "uk-1", ...generateSigningKeys() };

  it("signs the BLAKE2b-512 digest and verifies only the exact body, within the window", () => {
    const body = JSON.stringify({ context: { action: "search" }, message: {} });
    const auth = parseAuthorization(authorizationHeader(body, key, Date.parse("2026-10-26T10:00:00Z")))!;
    expect(auth).toMatchObject({ subscriberId: "zz-bap.test", ukId: "uk-1" });
    expect(auth.expires - auth.created).toBe(3600);
    const at = Date.parse("2026-10-26T10:10:00Z");
    expect(verifyAuthorization(body, auth, key.publicKey, at)).toBe(true);
    expect(verifyAuthorization(body.replace("search", "select"), auth, key.publicKey, at)).toBe(false);
    expect(verifyAuthorization(body, auth, generateSigningKeys().publicKey, at)).toBe(false);
    expect(verifyAuthorization(body, auth, key.publicKey, Date.parse("2026-10-26T11:30:00Z"))).toBe(false); // expired
  });

  it("accepts libsodium's 64-byte private keys and matches the known BLAKE2b-512 of an empty body", () => {
    const sodium = Buffer.concat([Buffer.from(key.privateKey, "base64"), Buffer.from(key.publicKey, "base64")]).toString("base64");
    const body = "{}";
    const auth = parseAuthorization(authorizationHeader(body, { ...key, privateKey: sodium }))!;
    expect(verifyAuthorization(body, auth, key.publicKey)).toBe(true);
    expect(Buffer.from(blake512(""), "base64").toString("hex")).toMatch(/^786a02f742015903c6c6fd852552d272/);
  });

  it("answers the registry's on_subscribe challenge", () => {
    const ours = generateKeyPairSync("x25519");
    const registry = generateKeyPairSync("x25519");
    const secret = diffieHellman({ privateKey: registry.privateKey, publicKey: ours.publicKey });
    const cipher = createCipheriv("aes-256-ecb", secret, null);
    const challenge = Buffer.concat([cipher.update("zz-challenge-1234"), cipher.final()]).toString("base64");
    const der = (k: typeof ours.privateKey, type: "pkcs8" | "spki") => k.export({ format: "der", type }).toString("base64");
    expect(decryptChallenge(challenge, der(ours.privateKey, "pkcs8"), der(registry.publicKey, "spki"))).toBe("zz-challenge-1234");
  });
});

describe("ONDC buyer flow (mock network)", () => {
  it("searches, gets a quote, sends delivery details, confirms, and records who started it", async () => {
    const { transactionId } = await search("kettle", "zz-ondc-user");
    expect(await transactionOwner(transactionId)).toBe("zz-ondc-user");
    const items = await searchResults(transactionId);
    const kettle = items.find((i) => i.itemId === "zz-ondc-kettle")!;
    expect(kettle).toMatchObject({ providerName: "ZZ Mock Kirana", price: 899, mrp: 1199, sellerApp: "ZZ Mock Seller App" });

    const pick = { bppId: kettle.bppId, providerId: kettle.providerId, itemId: kettle.itemId, quantity: 2, pincode: "560038" };
    await select(transactionId, pick, "zz-ondc-user");
    const quoted = await selectResult(transactionId);
    expect(quoted).toMatchObject({ quote: { total: 1838, deliveryTime: "P2D", fulfillmentId: "F1" } });

    await init(transactionId, pick, delivery, "zz-ondc-user");
    const terms = (await initResult(transactionId))!;
    expect(terms).toMatchObject({ payable: true, payment: { collectedBy: "BPP" } });

    await confirm(transactionId, "zz-ondc-user");
    expect(await orderState(transactionId)).toMatchObject({ state: "Accepted", fulfillmentState: "Pending" });
  });

  it("explains unserviceable pincodes and refuses buyer-app-collected payment", async () => {
    const { transactionId } = await search("kettle");
    const items = await searchResults(transactionId);
    const kettle = items.find((i) => i.itemId === "zz-ondc-kettle")!;
    await select(transactionId, { bppId: kettle.bppId, providerId: kettle.providerId, itemId: kettle.itemId, quantity: 1, pincode: "999001" }, "u");
    expect(await selectResult(transactionId)).toEqual({ error: "We don't deliver to that pincode." });

    const bapOnly = items.find((i) => i.itemId === "zz-bap-only")!;
    const pick = { bppId: bapOnly.bppId, providerId: bapOnly.providerId, itemId: bapOnly.itemId, quantity: 1, pincode: "560038" };
    await select(transactionId, pick, "u");
    await init(transactionId, pick, delivery, "u");
    expect(await initResult(transactionId)).toMatchObject({ payable: false, payment: { collectedBy: "BAP" } });
    await expect(confirm(transactionId, "u")).rejects.toThrow("buyer app");
  });

  it("rejects callbacks that are unsigned, forged by another key, or for unknown actions", async () => {
    const { transactionId } = await search("atta");
    const ctx = { action: "on_search", bap_id: process.env.ONDC_SUBSCRIBER_ID, bpp_id: "zz-mock-seller-app.ondc.test", transaction_id: transactionId, message_id: "m1" };
    const body = JSON.stringify({ context: ctx, message: { catalog: {} } });
    expect((await receiveCallback("on_search", body, null)).status).toBe(401);
    const forger = { subscriberId: "zz-mock-seller-app.ondc.test", ukId: "zz-mock-uk-1", ...generateSigningKeys() };
    expect((await receiveCallback("on_search", body, authorizationHeader(body, forger))).status).toBe(401);
    const stranger = JSON.stringify({ context: { ...ctx, transaction_id: "not-ours" }, message: {} });
    expect((await receiveCallback("on_search", stranger, authorizationHeader(stranger, forger))).status).toBe(401);
    expect((await receiveCallback("on_frobnicate", body, null)).status).toBe(404);
  });
});
