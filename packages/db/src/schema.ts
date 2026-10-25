import { sql } from "drizzle-orm";
import { bigint, doublePrecision, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * v1 schema: mirrors what the Redis store holds today so the app can dual-write and then switch
 * reads. Orgs, members, policies, payments and the ledger arrive in later migrations.
 * Domain objects are typed in apps/web; columns here hold what we query or constrain on, and
 * `data` keeps the rest of the document until those parts get their own tables.
 */
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  phone: text("phone").notNull().unique(), // E.164
  name: text("name").notNull(),
  email: text("email"),
  channel: text("channel").notNull(),
  city: text("city"),
  demographics: jsonb("demographics"),
  consentAt: ts("consent_at"),
  lastLoginAt: ts("last_login_at"),
  createdAt: ts("created_at").notNull(),
});

export const sellers = pgTable("sellers", {
  id: text("id").primaryKey(),
  storeName: text("store_name").notNull(),
  contactName: text("contact_name").notNull(),
  phone: text("phone").notNull().unique(),
  budgetPct: doublePrecision("budget_pct").notNull(),
  autoApproveShare: doublePrecision("auto_approve_share").notNull(),
  createdAt: ts("created_at").notNull(),
});

/** Marketplace names a seller trades under ("Clicktech Retail Private Ltd"), normalised. */
export const sellerAliases = pgTable(
  "seller_aliases",
  {
    alias: text("alias").primaryKey(),
    sellerId: text("seller_id")
      .notNull()
      .references(() => sellers.id, { onDelete: "cascade" }),
  },
  (t) => [index("seller_aliases_seller_idx").on(t.sellerId)],
);

/** Hashes of long-lived seller dashboard tokens. The raw token is never stored. */
export const sellerTokens = pgTable(
  "seller_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    sellerId: text("seller_id")
      .notNull()
      .references(() => sellers.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("seller_tokens_seller_idx").on(t.sellerId)],
);

export const deals = pgTable(
  "deals",
  {
    id: text("id").primaryKey(),
    // No foreign keys yet: during dual-write a deal can arrive before its user is backfilled.
    userId: text("user_id"),
    sellerId: text("seller_id"),
    status: text("status").notNull(),
    channel: text("channel").notNull(),
    city: text("city"),
    dealPrice: integer("deal_price").notNull(),
    createdAt: ts("created_at").notNull(),
    expiresAt: ts("expires_at").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    /** Bumped on every save; compare-and-set arrives with the negotiation state machine. */
    version: integer("version").notNull().default(1),
    data: jsonb("data").notNull(),
  },
  (t) => [
    index("deals_created_idx").on(t.createdAt.desc()),
    index("deals_user_idx").on(t.userId),
    index("deals_seller_idx").on(t.sellerId),
    index("deals_status_idx").on(t.status),
  ],
);

/** Append-only audit trail (signups, agent moves, approvals, payments). */
export const activity = pgTable(
  "activity",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    at: ts("at").notNull(),
    type: text("type").notNull(),
    actor: text("actor").notNull(),
    userId: text("user_id"),
    dealId: text("deal_id"),
    detail: text("detail").notNull(),
  },
  (t) => [index("activity_at_idx").on(t.at.desc()), index("activity_deal_idx").on(t.dealId), index("activity_user_idx").on(t.userId)],
);

export const visits = pgTable(
  "visits",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    vid: text("vid").notNull(),
    path: text("path").notNull(),
    at: ts("at").notNull(),
    data: jsonb("data").notNull(), // demographics
  },
  (t) => [index("visits_at_idx").on(t.at.desc())],
);

/** Running totals shown on the landing page and admin (users, deals, paid, saved). */
export const counters = pgTable("counters", {
  key: text("key").primaryKey(),
  value: bigint("value", { mode: "number" }).notNull().default(0),
});

/** Shoppers who wanted to buy from a marketplace seller, registered on GhostCart or not. */
export const sellerDemand = pgTable("seller_demand", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  marketplace: text("marketplace").notNull(),
  count: integer("count").notNull().default(0),
  updatedAt: ts("updated_at")
    .notNull()
    .default(sql`now()`),
});
