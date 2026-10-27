import { describe, expect, it } from "vitest";
import { assignVariant } from "./experiments";

const exp = { name: "zz_opening", variants: [{ name: "control", weight: 1 }, { name: "softer", weight: 1 }] };

describe("experiment assignment", () => {
  it("is sticky per subject and roughly follows the weights", () => {
    expect(assignVariant(exp, "user-1")).toBe(assignVariant(exp, "user-1"));
    const counts = { control: 0, softer: 0 } as Record<string, number>;
    for (let i = 0; i < 4000; i++) counts[assignVariant(exp, `u${i}`)]++;
    expect(counts.control / 4000).toBeGreaterThan(0.45);
    expect(counts.control / 4000).toBeLessThan(0.55);
    expect(assignVariant({ ...exp, variants: [{ name: "control", weight: 1 }, { name: "softer", weight: 0 }] }, "u1")).toBe("control");
  });
});
