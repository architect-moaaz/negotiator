import { describe, expect, it } from "vitest";
import { placeOrder, saveAddress } from "../checkout";
import { acceptOffer, markPaid } from "../negotiate";
import { getOrder, orderForDeal, refundOrder } from "../orders/service";
import { startShopNegotiation } from "../shop/negotiation";
import { createOrg } from "../shop/orgs";
import { createProduct } from "../shop/products";
import { createStore, updateStore } from "../shop/stores";
import { store } from "../store";
import { signUp } from "../users";
import { consentHistory, currentConsents, DEAL_CONTACT_WORDING, mayContact, recordConsent } from "./consent";
import { deleteShopperAccount, exportShopperData } from "./data";
import { acknowledgeGrievance, fileGrievance, grievanceDue, openGrievances, resolveGrievance } from "./grievances";

let n = 0;
const phone = () => `+9191000020${String(++n).padStart(2, "0")}`;

async function shopperWithOrder() {
  const user = await signUp({ name: "ZZ Privacy Shopper", phone: phone(), channel: "web", consent: true, source: "shop" });
  const org = await createOrg({ name: "ZZ Privacy", ownerPhone: phone(), ownerName: "ZZ" });
  const s = (await updateStore((await createStore({ orgId: org.id, name: "ZZ Privacy Store", platform: "ghostcart_shop" })).id, { status: "live", tier: "verified" }))!;
  const p = await createProduct(s.id, { title: "ZZ Privacy Item", price: 1500, stock: 3 });
  let deal = await startShopNegotiation(p.id, user.id);
  deal = await acceptOffer(deal);
  deal = await markPaid(deal, "pinelabs");
  deal = await saveAddress(deal, { name: "ZZ Privacy Shopper", phone: user.phone, line1: `${Math.random().toString(36).slice(2, 8)} Privacy Lane`, city: "Mysuru", state: "Karnataka", pincode: "570001" });
  deal = await placeOrder(deal, "pinelabs");
  return { user, deal, order: (await orderForDeal(deal.id))! };
}

describe("consent records", () => {
  it("records the exact signup wording, and the latest action wins", async () => {
    const user = await signUp({ name: "ZZ Consent", phone: phone(), channel: "web", consent: true, source: "shop" });
    const [first] = await consentHistory(user.id);
    expect(first).toMatchObject({ purpose: "deal_contact", action: "granted", wording: DEAL_CONTACT_WORDING, source: "signup:shop" });
    expect(await mayContact(user)).toBe(true);

    await recordConsent(user.id, "deal_contact", "withdrawn", "Withdrew consent to deal contact", "account_page");
    expect((await currentConsents(user.id)).deal_contact).toBe("withdrawn");
    expect(await mayContact(user)).toBe(false); // even though the account still carries a consentAt
  });

  it("falls back to the account timestamp for accounts made before consent records", async () => {
    expect(await mayContact({ id: "zz-old-account", consentAt: Date.now() })).toBe(true);
    expect(await mayContact({ id: "zz-old-account-2" })).toBe(false);
  });
});

describe("data export and deletion", () => {
  it("exports the profile, deals, orders and consents", async () => {
    const { user, deal, order } = await shopperWithOrder();
    const data = await exportShopperData(user);
    expect(data.profile.phone).toBe(user.phone);
    expect(data.deals.map((d) => d.id)).toContain(deal.id);
    expect(data.orders.map((o) => o.id)).toContain(order.id);
    expect(data.consents[0]?.wording).toBe(DEAL_CONTACT_WORDING);
  });

  it("won't delete while an order is open, then erases identity and keeps de-identified orders", async () => {
    const { user, deal, order } = await shopperWithOrder();
    await expect(deleteShopperAccount(user)).rejects.toThrow("isn't finished");

    await refundOrder(order.id, order.total, "ZZ test cancellation", "zz-test", "cancelled");
    await deleteShopperAccount(user);

    const erased = (await store.getUser(user.id))!;
    expect(erased.name).toBe("Deleted shopper");
    expect(erased.phone).not.toContain(user.phone.slice(3));
    expect(erased.email).toBeUndefined();
    expect(await store.userIdForPhone(user.phone)).toBeUndefined(); // the number can sign up afresh

    const kept = (await getOrder(order.id))!;
    expect(kept.total).toBe(order.total);
    expect(kept.address).toEqual({ name: "Erased", city: "Mysuru", state: "Karnataka", pincode: "570001" });

    const scrubbed = (await store.getDeal(deal.id))!;
    expect(scrubbed.userId).toBeUndefined();
    expect(scrubbed.checkout?.address?.line1).toBe("");
    expect((await currentConsents(user.id)).deal_contact).toBe("withdrawn");
  });
});

describe("grievances", () => {
  it("sets the 48-hour and one-month deadlines and moves through the queue", async () => {
    const now = new Date("2026-10-26T10:00:00Z");
    await expect(fileGrievance({ name: "ZZ", contact: "", category: "order", message: "short" })).rejects.toThrow();
    const g = await fileGrievance({ name: "ZZ Grievance", contact: "zz@example.com", category: "data_privacy", message: "ZZ test: please tell me what you hold." }, now);
    expect(g.acknowledgeBy.toISOString()).toBe("2026-10-28T10:00:00.000Z");
    expect(g.resolveBy.toISOString()).toBe("2026-11-25T10:00:00.000Z");
    expect(grievanceDue(g, now.getTime())).toMatchObject({ step: "acknowledge", overdue: false });
    expect(grievanceDue(g, new Date("2026-10-29T00:00:00Z").getTime()).overdue).toBe(true);
    expect((await openGrievances()).map((r) => r.id)).toContain(g.id);

    const acked = await acknowledgeGrievance(g.id, "ZZ Staff");
    expect(grievanceDue(acked).step).toBe("resolve");
    await expect(resolveGrievance(g.id, "ok", "ZZ Staff")).rejects.toThrow("reply");
    const done = await resolveGrievance(g.id, "We sent your data export to zz@example.com.", "ZZ Staff");
    expect(done.status).toBe("resolved");
    expect((await openGrievances()).map((r) => r.id)).not.toContain(g.id);
    await expect(resolveGrievance(g.id, "Again, with feeling.", "ZZ Staff")).rejects.toThrow("already");
  });
});
