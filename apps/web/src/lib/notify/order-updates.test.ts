import { describe, expect, it } from "vitest";
import { placeOrder, saveAddress } from "../checkout";
import { outbox } from "../email";
import { acceptOffer, markPaid } from "../negotiate";
import { confirmReceivedByBuyer, markShipped } from "../orders/fulfilment";
import { heldFor, orderForDeal, refundOrder } from "../orders/service";
import { recordConsent } from "../privacy/consent";
import { startShopNegotiation } from "../shop/negotiation";
import { createOrg } from "../shop/orgs";
import { createProduct } from "../shop/products";
import { createStore, updateStore } from "../shop/stores";
import { signUp } from "../users";
import { notifyShopperOrder, orderUpdateText } from "./order-updates";

let n = 0;
async function orderFor(email?: string) {
  n++;
  const user = await signUp({ name: "ZZ Order Buyer", phone: `+9190000027${String(n).padStart(2, "0")}`, email, channel: "web", consent: true });
  const org = await createOrg({ name: "ZZ Updates", ownerPhone: `+9190000028${String(n).padStart(2, "0")}`, ownerName: "ZZ" });
  const s = (await updateStore((await createStore({ orgId: org.id, name: "ZZ Updates Store", platform: "ghostcart_shop" })).id, { status: "live", tier: "verified" }))!;
  const p = await createProduct(s.id, { title: "ZZ Update Lamp", price: 2000, stock: 5 });
  let deal = await startShopNegotiation(p.id, user.id);
  deal = await acceptOffer(deal);
  deal = await markPaid(deal, "pinelabs");
  deal = await saveAddress(deal, { name: "ZZ Buyer", phone: user.phone, line1: `${n} Update Street`, city: "Pune", state: "Maharashtra", pincode: "411001" });
  deal = await placeOrder(deal, "pinelabs");
  return { user, order: (await orderForDeal(deal.id))! };
}
const mails = (to: string) => outbox.filter((m) => m.to === to).map((m) => m.subject.split(":")[0]);

describe("shopper order updates", () => {
  it("email each step once: placed, shipped (with tracking), delivered", async () => {
    const to = "zz.updates1@example.com";
    const { order } = await orderFor(to);
    await markShipped(order.id, { courier: "Delhivery", awb: "ZZ7654321" }, "seller");
    await markShipped(order.id, { courier: "Delhivery", awb: "ZZ7654321" }, "seller").catch(() => null); // second report: already shipped
    await confirmReceivedByBuyer(order.id);
    expect(mails(to)).toEqual(["Order placed", "Your order has shipped", "Delivered"]);
    expect(outbox.find((m) => m.to === to && m.subject.startsWith("Your order has shipped"))!.text).toContain("Delhivery (tracking ZZ7654321)");
    expect(outbox.find((m) => m.to === to)!.text).toContain(`/deal/${order.dealId}`);
  });

  it("tell the shopper about a cancellation and refund, without staff notes", async () => {
    const to = "zz.updates2@example.com";
    const { order } = await orderFor(to);
    const held = await heldFor(order);
    await refundOrder(order.id, held.sellerShare + held.fee + held.gst, "internal: suspected reseller", "staff:ZZ", "cancelled");
    const mail = outbox.find((m) => m.to === to && m.subject.startsWith("Order cancelled"))!;
    expect(mail.text).not.toContain("reseller");
    expect(mail.text).toContain("Banks usually take");
  });

  it("send nothing once the shopper withdraws contact consent", async () => {
    const to = "zz.updates3@example.com";
    const { user, order } = await orderFor(to);
    await recordConsent(user.id, "deal_contact", "withdrawn", "ZZ test", "test");
    expect(await notifyShopperOrder(order, "out_for_delivery")).toEqual({ sent: [] });
    expect(mails(to)).toEqual(["Order placed"]);
  });

  it("word refunds in rupees from paise", () => {
    expect(orderUpdateText({ id: "o", dealId: "d", userId: "u", title: "ZZ Lamp", total: 199900 }, "refunded", { refund: 50000 }).body).toContain("₹500");
  });
});
