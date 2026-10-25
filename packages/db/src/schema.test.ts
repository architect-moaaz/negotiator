import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { schema } from "./index";
import { createTestDb } from "./testing";

describe("migrations", () => {
  it("apply cleanly and enforce one account per phone", async () => {
    const db = await createTestDb();
    const row = { id: "u1", phone: "+919000000001", name: "ZZ Test", channel: "web", createdAt: new Date() };
    await db.insert(schema.users).values(row);
    await expect(db.insert(schema.users).values({ ...row, id: "u2" })).rejects.toThrow();
    expect(await db.select().from(schema.users).where(eq(schema.users.phone, row.phone))).toHaveLength(1);
  });

  it("removes a seller's aliases and tokens with the seller", async () => {
    const db = await createTestDb();
    await db.insert(schema.sellers).values({ id: "s1", storeName: "ZZ Store", contactName: "ZZ", phone: "+919000000002", budgetPct: 0.05, autoApproveShare: 0.6, createdAt: new Date() });
    await db.insert(schema.sellerAliases).values({ alias: "zz store", sellerId: "s1" });
    await db.insert(schema.sellerTokens).values({ tokenHash: "h", sellerId: "s1" });
    await db.delete(schema.sellers).where(eq(schema.sellers.id, "s1"));
    expect(await db.select().from(schema.sellerAliases)).toHaveLength(0);
    expect(await db.select().from(schema.sellerTokens)).toHaveLength(0);
  });
});
