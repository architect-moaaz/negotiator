import { describe, expect, it } from "vitest";
import { alertsForUser, setPriceAlert, stopPriceAlert } from "./alerts";
import { outbox } from "./email";
import { currentConsents } from "./privacy/consent";
import { createOrg } from "./shop/orgs";
import { createProduct, updateProduct } from "./shop/products";
import { createStore, updateStore } from "./shop/stores";
import { signUp } from "./users";

let n = 0;
async function setup() {
  n++;
  const user = await signUp({ name: "ZZ Alert Buyer", phone: `+9190000029${String(n).padStart(2, "0")}`, email: `zz.alert${n}@example.com`, channel: "web", consent: true });
  const org = await createOrg({ name: "ZZ Alerts", ownerPhone: `+9190000030${String(n).padStart(2, "0")}`, ownerName: "ZZ" });
  const s = (await updateStore((await createStore({ orgId: org.id, name: "ZZ Alerts Store", platform: "ghostcart_shop" })).id, { status: "live" }))!;
  const p = await createProduct(s.id, { title: "ZZ Alert Kettle", price: 2000, stock: 5 });
  const reprice = (price: number) => updateProduct(s.id, p.id, { title: p.title, price, stock: 5 });
  return { user, store: s, product: p, reprice };
}
const mailsTo = (to: string) => outbox.filter((m) => m.to === to);

describe("price-drop alerts", () => {
  it("fire once when the listed price reaches the target, and not before", async () => {
    const { user, product, reprice } = await setup();
    await setPriceAlert(user.id, product.id, 1700);
    expect((await currentConsents(user.id)).price_alerts).toBe("granted");
    await reprice(1800);
    expect(mailsTo(user.email!)).toHaveLength(0);
    await reprice(1690);
    const [mail] = mailsTo(user.email!);
    expect(mail.subject).toBe("Price dropped: ZZ Alert Kettle");
    expect(mail.text).toContain("now ₹1,690");
    await reprice(1500);
    expect(mailsTo(user.email!)).toHaveLength(1); // one message, then the alert is done
    expect(await alertsForUser(user.id)).toEqual([]);
  });

  it("need a target below today's price, and replace an earlier alert on the same product", async () => {
    const { user, product } = await setup();
    await expect(setPriceAlert(user.id, product.id, 2000)).rejects.toThrow("below today's");
    await expect(setPriceAlert(user.id, product.id, 50)).rejects.toThrow("too low");
    await setPriceAlert(user.id, product.id, 1800);
    await setPriceAlert(user.id, product.id, 1600);
    expect((await alertsForUser(user.id)).map((a) => a.targetPrice)).toEqual([1600]);
  });

  it("stop by the link token or from the account, recording the withdrawal", async () => {
    const { user, product, reprice } = await setup();
    const { stopToken } = await setPriceAlert(user.id, product.id, 1900);
    await stopPriceAlert({ token: stopToken });
    expect((await currentConsents(user.id)).price_alerts).toBe("withdrawn");
    await reprice(1500);
    expect(mailsTo(user.email!)).toHaveLength(0);
    const { alert } = await setPriceAlert(user.id, product.id, 1400);
    expect(await stopPriceAlert({ id: alert.id, userId: "someone-else" })).toBeUndefined();
    expect(await stopPriceAlert({ id: alert.id, userId: user.id })).toBeTruthy();
  });
});
