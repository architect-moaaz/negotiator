import { describe, expect, it } from "vitest";
import { playbook, type HaggleOutcome } from "./playbook";

const h = (offer: number, won = false, over: Partial<HaggleOutcome> = {}): HaggleOutcome => ({ productId: "p1", title: "ZZ Kurta", list: 1000, bestShopperOffer: offer, won, autoPct: 5, maxPct: 10, ...over });

describe("seller playbook", () => {
  it("suggests the agent-alone limit that would have closed most lost haggles, within the seller's max", () => {
    const [s] = playbook([h(930), h(920), h(940), h(910), h(980, true)]);
    expect(s).toMatchObject({ productId: "p1", haggles: 5, lost: 4, currentAutoPct: 5, suggestedAutoPct: 8, closable: 3 });
  });
  it("never suggests past the seller's own maximum, and stays quiet without enough evidence", () => {
    expect(playbook([h(850), h(800), h(820), h(860)])).toEqual([]); // shoppers wanted more than the 10% max
    expect(playbook([h(930), h(920)])).toEqual([]);
    expect(playbook([h(960), h(955), h(970)])).toEqual([]); // inside the agent's 5% already: not a limit problem
  });
  it("caps the suggestion at the max", () => {
    const [s] = playbook([h(900), h(901), h(902)]);
    expect(s.suggestedAutoPct).toBe(10);
  });
});
