import { describe, expect, it } from "vitest";
import { computeAnalytics } from "./analytics";
import { demographicsFrom } from "./demographics";
import type { Activity, Deal, User, Visit } from "./types";

describe("demographicsFrom", () => {
  it("reads geo headers and the user agent", () => {
    const req = new Request("https://x.test/api/signup", {
      headers: {
        "x-vercel-ip-city": "Bengaluru",
        "x-vercel-ip-country-region": "KA",
        "x-vercel-ip-country": "IN",
        "user-agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36",
        "accept-language": "en-IN,en;q=0.9",
      },
    });
    const d = demographicsFrom(req, { referrer: "https://www.linkedin.com/feed/", source: "qr-booth" });
    expect(d).toMatchObject({ city: "Bengaluru", region: "KA", country: "IN", device: "mobile", os: "Android", browser: "Chrome", language: "en-IN", referrer: "linkedin.com", source: "qr-booth" });
    expect(d.hourIst).toBeGreaterThanOrEqual(0);
  });

  it("detects iPhone Safari and desktop", () => {
    const iphone = demographicsFrom(new Request("https://x.test", { headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" } }));
    expect(iphone).toMatchObject({ device: "mobile", os: "iOS", browser: "Safari" });
    const mac = demographicsFrom(new Request("https://x.test", { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36" } }));
    expect(mac).toMatchObject({ device: "desktop", os: "macOS", browser: "Chrome" });
  });
});

describe("computeAnalytics", () => {
  const user = (id: string, city: string): User => ({ id, name: id, phone: `+9190000000${id}`, channel: "web", createdAt: Date.now(), demographics: { city, device: "mobile", source: "qr-booth" } });
  const deal = (id: string, userId: string, status: Deal["status"]): Deal =>
    ({
      id,
      userId,
      status,
      product: { title: "Sony WH-1000XM5 Headphones", seller: "Amazon", price: 20000, inStock: true },
      alternatives: [],
      originalPrice: 20000,
      dealPrice: 19000,
      saved: 1000,
      perk: "",
      bestSeller: "Amazon",
      haggle: "",
      lockFee: 9,
      simulate: true,
      createdAt: Date.now(),
      expiresAt: Date.now(),
      channel: "web",
      negotiation: { terms: { fundedBy: "ghostcart", category: "accessories" } as never, currentOffer: 19000, rounds: 2, messages: [] },
    }) as Deal;

  it("builds the funnel and KPIs from real records", () => {
    const visits: Visit[] = ["a", "b", "c", "d"].map((vid) => ({ vid, path: "/", at: Date.now() }));
    const activity: Activity[] = [{ at: 1, type: "deal_agreed", actor: "agent", dealId: "d1", detail: "" }, { at: 31_000, type: "payment_received", actor: "system", dealId: "d1", detail: "" }];
    const a = computeAnalytics({ users: [user("1", "Bengaluru"), user("2", "Chennai")], deals: [deal("d1", "1", "paid"), deal("d2", "2", "negotiating")], activity, visits });
    expect(a.kpis).toMatchObject({ visitors: 4, shoppers: 2, negotiations: 2, locked: 1, gmv: 19000, saved: 1000, lockRevenue: 9, visitorToShopperPct: 50, shopperToLockedPct: 50, medianSecondsToPay: 31 });
    expect(a.funnel.map((f) => f.value)).toEqual([4, 2, 2, 2, 1, 1]);
    expect(a.demographics.city.map((c) => c.label).sort()).toEqual(["Bengaluru", "Chennai"]);
    expect(a.demographics.source).toEqual([{ label: "qr-booth", value: 2 }]);
  });
});
