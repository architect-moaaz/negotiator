import { afterEach, describe, expect, it } from "vitest";
import { GET as gupshupSent } from "@/app/api/mock-gupshup/wa/api/v1/msg/route";
import { outbox } from "../email";
import { connectGupshup } from "../gupshup/gupshup";
import { createOrg } from "../shop/orgs";
import { setPolicy } from "../shop/policies";
import { createProduct } from "../shop/products";
import { createStore, updateStore } from "../shop/stores";
import { captureCart, getCart, updateCart } from "./carts";
import { createInvite, invitesForCart } from "./invites";
import { runRecovery } from "./job";
import { withinContactHours } from "./send";
import { setRecovery } from "./settings";

// 10:30 and 22:30 IST on a fixed day.
const DAY = new Date("2026-11-02T05:00:00Z");
const DAYTIME = DAY;
const NIGHT = new Date("2026-11-02T17:00:00Z");
const longAgo = new Date(DAY.getTime() - 3 * 3600_000);

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

let n = 0;
async function setup(channels: ("email" | "whatsapp" | "voice")[] = ["email"]) {
  n++;
  const org = await createOrg({ name: "ZZ Recovery Seller", ownerPhone: `+9190000021${String(n).padStart(2, "0")}`, ownerName: "ZZ" });
  const s = (await updateStore((await createStore({ orgId: org.id, name: `ZZ Recovery Store ${n}`, platform: "ghostcart_shop" })).id, { status: "live" }))!;
  await setPolicy(s.id, "store", null, { maxDiscountPct: 10, autoApprovePct: 5 });
  await setRecovery(s.id, { enabled: true, delayMinutes: 60, channels });
  const p = await createProduct(s.id, { title: "ZZ Recovery Lamp", price: 1800, stock: 5 });
  const cart = async (contact?: { email?: string; phone?: string }, ref = `ck-${n}-${Math.random()}`) => {
    const c = await captureCart({ storeId: s.id, source: "woo_checkout", externalRef: ref, items: [{ ref: p.id, quantity: 1 }], contact, consent: !!contact });
    return (await updateCart(c.id, { lastActivityAt: longAgo }))!;
  };
  return { store: s, cart };
}

describe("GhostCart Privilege recovery job", () => {
  it("knows India's contact hours", () => {
    expect(withinContactHours(DAYTIME)).toBe(true);
    expect(withinContactHours(NIGHT)).toBe(false);
    expect(withinContactHours(new Date("2026-11-02T03:29:00Z"))).toBe(false); // 08:59 IST
    expect(withinContactHours(new Date("2026-11-02T03:30:00Z"))).toBe(true); // 09:00 IST
  });

  it("abandons idle carts, emails one private offer to shoppers who agreed, and never twice", async () => {
    const { store, cart } = await setup(["email"]);
    const yes = await cart({ email: "zz.recover@example.com" });
    const no = await cart();
    const before = outbox.length;
    const run = await runRecovery(DAYTIME);
    expect(run.sent).toBeGreaterThanOrEqual(1);
    expect((await getCart(yes.id))?.status).toBe("invited");
    expect((await getCart(no.id))?.status).toBe("abandoned");
    const mail = outbox.slice(before).find((m) => m.to === "zz.recover@example.com")!;
    expect(mail.subject).toBe(`A private offer on your cart from ${store.name}`);
    expect(mail.text).toMatch(/\/p\/[A-Za-z0-9_-]{32}/);
    expect(mail.text).toContain("₹1,800");
    expect(mail.unsubscribeUrl).toMatch(/\/p\//);
    expect((await invitesForCart(yes.id)).map((i) => [i.channel, i.status])).toEqual([["email", "sent"]]);
    const { recoveryStats } = await import("./stats");
    expect(await recoveryStats(store.id, new Date(0))).toMatchObject({ captured: 2, withConsent: 1, abandoned: 2, invited: 1, invitesByChannel: { email: 1 }, recovered: 0 });

    // Back to abandoned (e.g. the shopper came back and left again): still no second offer.
    await updateCart(yes.id, { status: "abandoned" });
    await runRecovery(DAYTIME);
    expect(outbox.filter((m) => m.to === "zz.recover@example.com")).toHaveLength(1);
  });

  it("waits for daytime, and doesn't count the shopper's own 'Make an offer' link as an invite", async () => {
    const { cart } = await setup(["email"]);
    const c = await cart({ email: "zz.night@example.com" });
    await createInvite(c.id, "link");
    await runRecovery(NIGHT);
    expect((await getCart(c.id))?.status).toBe("abandoned");
    expect(outbox.some((m) => m.to === "zz.night@example.com")).toBe(false);
    await runRecovery(DAYTIME);
    expect((await getCart(c.id))?.status).toBe("invited");
  });

  it("sends the WhatsApp template from the store's own number, with the link token in the button", async () => {
    process.env.WHATSAPP_PRIVILEGE_TEMPLATE = "zz_privilege_offer";
    const { store, cart } = await setup(["whatsapp", "email"]);
    await connectGupshup(store.id, { appName: "zz-priv-app", apiKey: "zz-gupshup-api-key-0002", phone: `90000022${String(n).padStart(2, "0")}` });
    const c = await cart({ phone: "9876500031", email: "zz.wa@example.com" });
    await runRecovery(DAYTIME);
    const sent = (await (await gupshupSent()).json()) as { destination: string; template?: { id: string; params: string[] } }[];
    const msg = sent.filter((m) => m.destination === "919876500031").at(-1)!;
    expect(msg.template?.id).toBe("zz_privilege_offer");
    expect(msg.template?.params.slice(0, 3)).toEqual([store.name, "ZZ Recovery Lamp", "₹1,800"]);
    expect(msg.template?.params.at(-1)).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect((await invitesForCart(c.id)).map((i) => i.channel)).toEqual(["whatsapp"]);
    expect(outbox.some((m) => m.to === "zz.wa@example.com")).toBe(false);
  });

  it("skips channels the store can't send on, and calls only when voice invites are switched on", async () => {
    const { cart } = await setup(["voice", "whatsapp"]);
    const c = await cart({ phone: "9876500032" }); // no WhatsApp number connected, calls off by default
    await runRecovery(DAYTIME);
    expect((await getCart(c.id))?.status).toBe("abandoned");
    expect(await invitesForCart(c.id)).toEqual([]);
  });

  it("expires carts idle for a week", async () => {
    const { cart } = await setup();
    const c = await cart();
    await runRecovery(new Date(DAY.getTime() + 8 * 24 * 3600_000));
    expect((await getCart(c.id))?.status).toBe("expired");
  });
});

describe("GhostCart Privilege stops", () => {
  it("stops on a WhatsApp STOP reply to the store's number", async () => {
    process.env.WHATSAPP_PRIVILEGE_TEMPLATE = "zz_privilege_offer";
    const { store, cart } = await setup(["whatsapp"]);
    const { webhookUrl } = await connectGupshup(store.id, { appName: "zz-priv-stop", apiKey: "zz-gupshup-api-key-0003", phone: `90000023${String(n).padStart(2, "0")}` });
    const c = await cart({ phone: "9876500033" });
    await runRecovery(DAYTIME);
    const { POST: inbound } = await import("@/app/api/gupshup/webhook/[token]/route");
    const body = { app: "zz", type: "message", version: 2, payload: { id: `stop-${n}`, source: "919876500033", type: "text", payload: { text: "STOP" }, sender: { phone: "919876500033", name: "ZZ" } } };
    await inbound(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ token: webhookUrl.split("/").pop()! }) } as never);
    expect((await getCart(c.id))?.status).toBe("opted_out");
    const sent = (await (await gupshupSent()).json()) as { destination: string; message?: { text: string } }[];
    expect(sent.filter((m) => m.destination === "919876500033").at(-1)?.message?.text).toMatch(/won't send you offers/);
  });

  it("offers press 1 for the link and press 9 to stop on an invite call", async () => {
    process.env.VOBIZ_WEBHOOK_SECRET = "zz-voice-secret";
    const { store, cart } = await setup(["voice", "email"]);
    const c = await cart({ phone: "9876500034", email: "zz.voice@example.com" });
    await updateCart(c.id, { status: "invited" });
    const { invite } = await createInvite(c.id, "voice");
    const { privilegeVoiceUrl } = await import("../vobiz");
    const route = await import("@/app/api/voice/privilege/route");
    const post = (url: string, digits?: string) => route.POST(new Request(url, { method: "POST", body: digits ? new URLSearchParams({ Digits: digits }) : undefined }));

    expect((await post(privilegeVoiceUrl(invite.id).replace(/k=[^&]+/, "k=forged"))).status).toBe(403);
    const answer = await (await post(privilegeVoiceUrl(invite.id))).text();
    expect(answer).toContain(`calling for ${store.name}`);
    expect(answer).toContain("Press 1");

    const before = outbox.length;
    expect(await (await post(privilegeVoiceUrl(invite.id, "keys"), "1")).text()).toContain("by email");
    expect(outbox.slice(before).some((m) => m.to === "zz.voice@example.com")).toBe(true);

    expect(await (await post(privilegeVoiceUrl(invite.id, "keys"), "9")).text()).toContain("won't send you offers");
    expect((await getCart(c.id))?.status).toBe("opted_out");
  });
});
