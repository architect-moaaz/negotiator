import { describe, expect, it } from "vitest";
import { inviteCode, recordReferral, referralCount } from "./referrals";
import { removeBoost, setBoost } from "./shop/boosts";
import { searchCatalogue } from "./shop/catalogue";
import { createOrg } from "./shop/orgs";
import { createProduct } from "./shop/products";
import { createStore, updateStore } from "./shop/stores";
import { signUp } from "./users";

describe("invite links", () => {
  it("credit the inviter once, only for a new account, and never themselves", async () => {
    const inviter = await signUp({ name: "ZZ Inviter", phone: "+919000003601", channel: "web", consent: true });
    const code = await inviteCode(inviter.id);
    expect(await inviteCode(inviter.id)).toBe(code);
    const friend = await signUp({ name: "ZZ Friend", phone: "+919000003602", channel: "web", consent: true, inviteCode: code.toLowerCase() });
    await signUp({ name: "ZZ Friend", phone: "+919000003602", channel: "web", consent: true, inviteCode: code }); // signing back in
    expect(await recordReferral(code, inviter.id)).toBeNull();
    expect(await recordReferral("NOTACODE", friend.id)).toBeNull();
    expect(await referralCount(inviter.id)).toBe(1);
  });
});

describe("promoted listings", () => {
  it("show boosted products first, marked sponsored, until the boost ends", async () => {
    const tag = `zzboost${Date.now().toString(36)}`;
    const org = await createOrg({ name: "ZZ Boost", ownerPhone: "+919000003603", ownerName: "ZZ" });
    const s = (await updateStore((await createStore({ orgId: org.id, name: "ZZ Boost Store", platform: "ghostcart_shop" })).id, { status: "live" }))!;
    const plain = await createProduct(s.id, { title: `${tag} plain mug`, price: 300, stock: 3 });
    const boosted = await createProduct(s.id, { title: `${tag} boosted mug`, price: 350, stock: 3 });
    const newer = await createProduct(s.id, { title: `${tag} newest mug`, price: 320, stock: 3 });
    await expect(setBoost(boosted.id, 0, "x", "ZZ Staff")).rejects.toThrow("1 to 90");
    await setBoost(boosted.id, 7, "ZZ test boost", "ZZ Staff");
    const items = await searchCatalogue(tag);
    expect(items[0]).toMatchObject({ productId: boosted.id, sponsored: true });
    expect(items.filter((i) => i.sponsored)).toHaveLength(1);
    expect(items.map((i) => i.productId)).toEqual(expect.arrayContaining([plain.id, newer.id]));
    await removeBoost(boosted.id, "ZZ Staff");
    expect((await searchCatalogue(tag)).every((i) => !i.sponsored)).toBe(true);
  });
});
