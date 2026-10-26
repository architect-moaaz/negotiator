import { describe, expect, it } from "vitest";
import { POST as inbound } from "@/app/api/gupshup/webhook/[token]/route";
import { GET as sentLog } from "@/app/api/mock-gupshup/wa/api/v1/msg/route";
import { decideApproval } from "../negotiate";
import { createOrg } from "../shop/orgs";
import { setPolicy } from "../shop/policies";
import { createProduct } from "../shop/products";
import { createStore, updateStore } from "../shop/stores";
import { store as kv } from "../store";
import { connectGupshup } from "./gupshup";

const sent = async () => (await (await sentLog()).json()) as { source: string; destination: string; app: string; message: { type: string; text: string } }[];
const msg = (id: string, from: string, text: string) => ({ app: "zz-app", type: "message", version: 2, payload: { id, source: from, type: "text", payload: { text }, sender: { phone: from, name: "ZZ Shopper" } } });

describe("WhatsApp through Gupshup", () => {
  it("connects with a secret inbound URL, haggles through the same chat engine, and relays the seller's decision", async () => {
    const org = await createOrg({ name: "ZZ Gupshup", ownerPhone: "+919000009601", ownerName: "ZZ" });
    const s = (await updateStore((await createStore({ orgId: org.id, name: "ZZ Gupshup Store", platform: "ghostcart_shop" })).id, { status: "live", tier: "verified" }))!;
    await setPolicy(s.id, "store", null, { maxDiscountPct: 10, autoApprovePct: 5 });
    const p = await createProduct(s.id, { title: "ZZ Gupshup Lamp", price: 4000, stock: 5 });
    await expect(connectGupshup(s.id, { appName: "zz app!", apiKey: "x", phone: "1" })).rejects.toThrow();
    const { webhookUrl } = await connectGupshup(s.id, { appName: "zz-gupshup-app", apiKey: "zz-gupshup-api-key-0001", phone: "9000009602" });
    const token = webhookUrl.split("/").pop()!;
    const call = (body: unknown, t = token) => inbound(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ token: t }) } as never);

    expect((await call(msg("m0", "919000009603", "hi"), "wrong-token")).status).toBe(404);
    const shopper = "919000009603";
    await call(msg("m1", shopper, `https://ghostcart.test/s/${s.slug}/${p.id}`));
    let out = (await sent()).filter((m) => m.destination === shopper);
    expect(out.at(-1)).toMatchObject({ source: "919000009602", app: "zz-gupshup-app", message: { type: "text" } });
    expect(out.at(-1)!.message.text).toMatch(/4,000|make me an offer/i);

    await call(msg("m1", shopper, "3600")); // Gupshup retried the same message id: handled once
    for (const [i, offer] of ["3600", "3600", "3600", "3600"].entries()) await call(msg(`m${i + 2}`, shopper, offer));
    const deal = (await kv.listDeals()).find((d) => d.chat?.threadKey === `gs:919000009602:${shopper}`)!;
    expect(deal.status).toBe("awaiting_approval");

    await decideApproval(deal, "approved", "ZZ Owner", "seller");
    out = (await sent()).filter((m) => m.destination === shopper);
    expect(out.at(-1)!.message.text).toMatch(/approved ₹3,600/i);
    expect(await call({ type: "message-event", payload: { id: "e1", type: "delivered" } })).toMatchObject({ status: 200 });
  });
});
