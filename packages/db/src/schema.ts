import { sql } from "drizzle-orm";
import { bigint, boolean, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

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

/* ---------- Wave 1: seller businesses, their stores, catalogue and discount rules ---------- */

/** A seller business. Everything a seller owns hangs off an org. */
export const orgs = pgTable("orgs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** People who can act for an org, by verified phone number. */
export const members = pgTable(
  "members",
  {
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    phone: text("phone").notNull(), // E.164
    name: text("name").notNull(),
    role: text("role").notNull(), // owner | admin | approver | viewer
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.phone] }), index("members_phone_idx").on(t.phone)],
);

export const stores = pgTable(
  "stores",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** URL name for the hosted shop: ghostcart.app/s/<slug>. */
    slug: text("slug").notNull().unique(),
    /** How the seller sells: ghostcart_shop | website | shopify | woocommerce | amazon | flipkart. */
    platform: text("platform").notNull(),
    domain: text("domain"),
    /** draft → pending_review → live; suspended by staff. */
    status: text("status").notNull().default("draft"),
    /** new | verified | trusted: sets order caps and payout hold length. */
    tier: text("tier").notNull().default("new"),
    verifiedAt: ts("verified_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("stores_org_idx").on(t.orgId)],
);

export const categories = pgTable(
  "categories",
  {
    id: text("id").primaryKey(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("categories_store_name_idx").on(t.storeId, t.name)],
);

export const products = pgTable(
  "products",
  {
    id: text("id").primaryKey(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    categoryId: text("category_id").references(() => categories.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    /** List price in INR: the benchmark the agent negotiates down from. */
    price: integer("price").notNull(),
    mrp: integer("mrp"),
    stock: integer("stock").notNull().default(0),
    images: jsonb("images").$type<string[]>().notNull().default([]),
    sku: text("sku"),
    /** active | draft | archived */
    status: text("status").notNull().default("active"),
    /** Where it came from: manual | csv | shopify:<id> | amazon:<asin> … */
    source: text("source").notNull().default("manual"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("products_store_idx").on(t.storeId), index("products_category_idx").on(t.categoryId)],
);

/** Discount rules. One row per level: the store default, a category, or a product. */
export const policies = pgTable(
  "policies",
  {
    id: text("id").primaryKey(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(), // store | category | product
    categoryId: text("category_id").references(() => categories.id, { onDelete: "cascade" }),
    productId: text("product_id").references(() => products.id, { onDelete: "cascade" }),
    enabled: boolean("enabled"),
    maxDiscountPct: doublePrecision("max_discount_pct"),
    autoApprovePct: doublePrecision("auto_approve_pct"),
    floorPrice: integer("floor_price"),
    maxRounds: integer("max_rounds"),
    expiryMinutes: integer("expiry_minutes"),
    bundlesAllowed: boolean("bundles_allowed"),
    channels: jsonb("channels").$type<string[]>(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("policies_store_level_idx").on(t.storeId).where(sql`scope = 'store'`),
    uniqueIndex("policies_category_level_idx").on(t.categoryId).where(sql`scope = 'category'`),
    uniqueIndex("policies_product_level_idx").on(t.productId).where(sql`scope = 'product'`),
  ],
);
