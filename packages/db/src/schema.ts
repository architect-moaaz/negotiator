import { sql } from "drizzle-orm";
import { bigint, boolean, date, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

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
  /** As on PAN/GST, filled in during verification. */
  legalName: text("legal_name"),
  /** individual | proprietorship | partnership | company | llp */
  businessType: text("business_type"),
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
    /** Random token the seller publishes in DNS or a meta tag to prove they control `domain`. */
    verificationToken: text("verification_token"),
    reviewNote: text("review_note"),
    /**
     * What the Consumer Protection (E-Commerce) Rules 2020 make us show buyers: the seller's address,
     * customer care contact, and return policy. Legal name and GSTIN come from verification.
     */
    disclosure: jsonb("disclosure").$type<{
      address: string;
      city: string;
      state: string;
      pincode: string;
      supportPhone: string;
      supportEmail?: string;
      returnDays: number;
      returnPolicy: string;
    }>(),
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
    /** Shown on the product page (Legal Metrology (Packaged Commodities) Rules, for e-commerce). */
    countryOfOrigin: text("country_of_origin"),
    sku: text("sku"),
    /** Product identity for same-item matching across stores (GhostCart Privilege, Rescue my cart). */
    brand: text("brand"),
    /** Barcode: EAN-13 / UPC / GTIN-14, digits only. */
    gtin: text("gtin"),
    /** Manufacturer model number, e.g. WH-1000XM5. */
    modelNumber: text("model_number"),
    /** active | draft | archived */
    status: text("status").notNull().default("active"),
    /** Where it came from: manual | csv | shopify:<id> | amazon:<asin> … */
    source: text("source").notNull().default("manual"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("products_store_idx").on(t.storeId),
    index("products_category_idx").on(t.categoryId),
    // Catalogue sync (/api/v1/products) upserts by SKU, so a SKU is unique within a store.
    uniqueIndex("products_store_sku_idx").on(t.storeId, t.sku).where(sql`sku is not null`),
    // Rescue my cart looks up the same barcode across every store.
    index("products_gtin_idx").on(t.gtin).where(sql`gtin is not null`),
  ],
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

/**
 * Verification evidence for a seller business or store, one row per check. Raw PAN and bank account
 * numbers are never stored: `masked` is for display and `identityHash` (HMAC) spots the same identity
 * reused across accounts.
 */
export const kycChecks = pgTable(
  "kyc_checks",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    storeId: text("store_id").references(() => stores.id, { onDelete: "cascade" }),
    /** pan | gstin | bank | ownership_dns | ownership_meta | ownership_photo | ownership_marketplace */
    type: text("type").notNull(),
    /** pending | passed | failed | manual_review */
    status: text("status").notNull(),
    /** sandbox | manual | <provider name> */
    provider: text("provider").notNull(),
    providerRef: text("provider_ref"),
    masked: text("masked"),
    identityHash: text("identity_hash"),
    /** Name returned by the provider (for the name match), file URLs, the provider's reason, … */
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    reviewedBy: text("reviewed_by"),
    reviewedAt: ts("reviewed_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("kyc_checks_org_idx").on(t.orgId), index("kyc_checks_hash_idx").on(t.identityHash)],
);

/* ---------- Wave 1: orders, money held until delivery, the ledger ---------- */

/** A placed order for a GhostCart Shop product. The seller ships it; money is held until delivery. */
export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    dealId: text("deal_id").notNull().unique(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id),
    userId: text("user_id").notNull(),
    productId: text("product_id").references(() => products.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    /** Money in paise: see packages/core money.ts. */
    total: bigint("total", { mode: "number" }).notNull(),
    fee: bigint("fee", { mode: "number" }).notNull(),
    gst: bigint("gst", { mode: "number" }).notNull(),
    sellerShare: bigint("seller_share", { mode: "number" }).notNull(),
    lockFee: bigint("lock_fee", { mode: "number" }).notNull(),
    /** placed → shipped → delivered → completed; or cancelled / refunded; disputed while a dispute is open. */
    status: text("status").notNull().default("placed"),
    testPayments: boolean("test_payments").notNull().default(false),
    /** The seller ships by this time or the order is cancelled and refunded. */
    shipBy: ts("ship_by").notNull(),
    shippedAt: ts("shipped_at"),
    deliveredAt: ts("delivered_at"),
    /** Delivery address, needed by the seller to ship. */
    address: jsonb("address").$type<Record<string, string>>().notNull(),
    /** Set when a fraud check flags the order: the payout stays held until staff clear it. */
    flagged: text("flagged"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("orders_store_idx").on(t.storeId), index("orders_status_idx").on(t.status), index("orders_user_idx").on(t.userId)],
);

/** The seller's share, settled on hold by the payment aggregator and released after the dispute window. */
export const holds = pgTable(
  "holds",
  {
    orderId: text("order_id")
      .primaryKey()
      .references(() => orders.id),
    /** held → released | refunded; frozen while a dispute is open. */
    state: text("state").notNull().default("held"),
    amount: bigint("amount", { mode: "number" }).notNull(),
    gateway: text("gateway").notNull(),
    gatewayRef: text("gateway_ref"),
    /** Set when delivery is confirmed: delivered_at + the tier's hold days. */
    releaseAt: ts("release_at"),
    releasedAt: ts("released_at"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("holds_release_idx").on(t.state, t.releaseAt)],
);

/** Double-entry ledger: every transaction (txn_id) sums to zero. Paise. Append-only. */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    txnId: text("txn_id").notNull(),
    orderId: text("order_id").references(() => orders.id),
    /** paid | released | refund | adjustment */
    kind: text("kind").notNull(),
    account: text("account").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    memo: text("memo"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("ledger_txn_idx").on(t.txnId), index("ledger_order_idx").on(t.orderId), index("ledger_account_idx").on(t.account)],
);

export const refunds = pgTable(
  "refunds",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    amount: bigint("amount", { mode: "number" }).notNull(),
    reason: text("reason").notNull(),
    /** pending → processed | failed */
    status: text("status").notNull().default("pending"),
    gatewayRef: text("gateway_ref"),
    requestedBy: text("requested_by").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("refunds_order_idx").on(t.orderId)],
);

/** The seller's shipment for an order: courier, AWB and what tracking says. */
export const shipments = pgTable("shipments", {
  orderId: text("order_id")
    .primaryKey()
    .references(() => orders.id),
  courier: text("courier").notNull(),
  awb: text("awb").notNull(),
  /** Who we ask for tracking: shiprocket | mock | none. */
  trackingProvider: text("tracking_provider").notNull(),
  /** in_transit | out_for_delivery | delivered | returned | unknown */
  lastStatus: text("last_status").notNull().default("unknown"),
  events: jsonb("events").$type<{ at: string; status: string; note?: string }[]>().notNull().default([]),
  /** Four digits the buyer reads out at handover; the seller enters them to confirm delivery. */
  handoverCode: text("handover_code").notNull(),
  /** Booked through the aggregator (one-click pickup): its shipment id, label and pickup date. */
  bookingRef: text("booking_ref"),
  labelUrl: text("label_url"),
  pickupAt: ts("pickup_at"),
  lastCheckedAt: ts("last_checked_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** A buyer's problem with an order. While open, the seller's payout is frozen. */
export const disputes = pgTable(
  "disputes",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    /** not_received | damaged | not_as_described | other */
    reason: text("reason").notNull(),
    details: text("details").notNull(),
    evidence: jsonb("evidence").$type<string[]>().notNull().default([]),
    sellerResponse: text("seller_response"),
    sellerEvidence: jsonb("seller_evidence").$type<string[]>().notNull().default([]),
    /** open → refunded | partial_refund | released */
    status: text("status").notNull().default("open"),
    resolution: text("resolution"),
    resolvedBy: text("resolved_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
    resolvedAt: ts("resolved_at"),
  },
  (t) => [index("disputes_order_idx").on(t.orderId), index("disputes_status_idx").on(t.status)],
);

/**
 * A buyer asks to return a delivered order within the store's return window. The payout is frozen while
 * it's open. requested → accepted → received (refunded) | declined | escalated (became a dispute).
 */
export const returnRequests = pgTable(
  "return_requests",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    /** changed_mind | damaged | not_as_described | wrong_item | other */
    reason: text("reason").notNull(),
    details: text("details").notNull(),
    evidence: jsonb("evidence").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("requested"),
    /** How the seller will collect it (accepted), or why not (declined). */
    sellerNote: text("seller_note"),
    createdAt: ts("created_at").notNull().defaultNow(),
    decidedAt: ts("decided_at"),
    closedAt: ts("closed_at"),
  },
  (t) => [index("return_requests_order_idx").on(t.orderId), index("return_requests_status_idx").on(t.status)],
);

/**
 * A rating from the buyer of a delivered order: one per order, never edited, never paid for. Sellers can
 * reply once; staff can hide abusive ones (with a reason, logged), never change the rating.
 */
export const productReviews = pgTable(
  "product_reviews",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id),
    storeId: text("store_id").notNull(),
    productId: text("product_id"),
    userId: text("user_id").notNull(),
    /** First name and initial, as shown. */
    authorName: text("author_name").notNull(),
    rating: integer("rating").notNull(),
    body: text("body").notNull().default(""),
    sellerReply: text("seller_reply"),
    sellerRepliedAt: ts("seller_replied_at"),
    hiddenAt: ts("hidden_at"),
    hiddenReason: text("hidden_reason"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("product_reviews_order_idx").on(t.orderId), index("product_reviews_product_idx").on(t.productId), index("product_reviews_store_idx").on(t.storeId)],
);

/** A store's "when I'm away" approval rule (packages/core away.ts). One row per store. */
export const awayRules = pgTable("away_rules", {
  storeId: text("store_id")
    .primaryKey()
    .references(() => stores.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  maxPctOff: doublePrecision("max_pct_off").notNull().default(0),
  days: integer("days").array().notNull().default(sql`'{0,1,2,3,4,5,6}'::integer[]`),
  startHour: integer("start_hour").notNull().default(21),
  endHour: integer("end_hour").notNull().default(9),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Each shopper's invite code (Rescue, referrals). Created on first use. */
export const referralCodes = pgTable("referral_codes", {
  code: text("code").primaryKey(),
  userId: text("user_id").notNull().unique(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Who brought whom: recorded once, when a new shopper signs up through an invite link. */
export const referrals = pgTable(
  "referrals",
  {
    referredUserId: text("referred_user_id").primaryKey(),
    referrerUserId: text("referrer_user_id").notNull(),
    code: text("code").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("referrals_referrer_idx").on(t.referrerUserId)],
);

/** Promoted listings: staff-set, time-limited, always labelled "Sponsored" to shoppers. */
export const productBoosts = pgTable("product_boosts", {
  productId: text("product_id")
    .primaryKey()
    .references(() => products.id, { onDelete: "cascade" }),
  storeId: text("store_id").notNull(),
  until: ts("until").notNull(),
  note: text("note").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/* ---------- Fraud signals ---------- */

/** Which accounts have used which device (the hashed visitor cookie). Used to spot self-dealing and multi-accounting. */
export const deviceLinks = pgTable(
  "device_links",
  {
    deviceHash: text("device_hash").notNull(),
    /** buyer (user id) | member (phone) */
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    firstSeen: ts("first_seen").notNull().defaultNow(),
    lastSeen: ts("last_seen").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.deviceHash, t.actorType, t.actorId] }), index("device_links_actor_idx").on(t.actorType, t.actorId)],
);

/** Something a fraud check noticed or blocked, for the staff fraud dashboard. */
export const riskEvents = pgTable(
  "risk_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    /** self_dealing | velocity | buyer_risk | multi_account | order_flagged | tier_promoted */
    kind: text("kind").notNull(),
    /** blocked | flagged | info */
    action: text("action").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    reviewedBy: text("reviewed_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("risk_events_created_idx").on(t.createdAt.desc()), index("risk_events_subject_idx").on(t.subjectType, t.subjectId)],
);

/* ---------- Integrations: API keys and outbound webhooks ---------- */

/**
 * Seller API keys. Publishable keys (gc_pk_) go in the widget on the seller's site and only work from
 * its allowed origins; secret keys (gc_sk_) are for the seller's servers. Only a hash is stored.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    /** publishable | secret */
    kind: text("kind").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    /** First characters, to tell keys apart in the dashboard. */
    prefix: text("prefix").notNull(),
    allowedOrigins: jsonb("allowed_origins").$type<string[]>().notNull().default([]),
    createdBy: text("created_by").notNull(),
    lastUsedAt: ts("last_used_at"),
    revokedAt: ts("revoked_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("api_keys_store_idx").on(t.storeId)],
);

/** Where GhostCart sends order events for a store, signed with a per-endpoint secret (stored encrypted). */
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: text("id").primaryKey(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secretEncrypted: text("secret_encrypted").notNull(),
    events: jsonb("events").$type<string[]>().notNull().default([]),
    active: boolean("active").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("webhook_endpoints_store_idx").on(t.storeId)],
);

/** Every delivery attempt, for the seller's "recent deliveries" view and retries. */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    endpointId: text("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** pending | delivered | failed */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    responseCode: integer("response_code"),
    nextAttemptAt: ts("next_attempt_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("webhook_deliveries_endpoint_idx").on(t.endpointId), index("webhook_deliveries_retry_idx").on(t.status, t.nextAttemptAt)],
);

/** A seller's connection to their own commerce platform (Shopify today, WooCommerce next). Tokens encrypted. */
export const platformConnections = pgTable(
  "platform_connections",
  {
    id: text("id").primaryKey(),
    /** Null until the installing merchant signs in to GhostCart and picks or creates the store. */
    storeId: text("store_id").references(() => stores.id, { onDelete: "set null" }),
    platform: text("platform").notNull(),
    /** e.g. zz-shop.myshopify.com, or the WooCommerce site URL. */
    externalId: text("external_id").notNull(),
    accessTokenEncrypted: text("access_token_encrypted").notNull(),
    scopes: text("scopes"),
    /** Platform-specific settings: billing subscription id, primary domain, … */
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    installedAt: ts("installed_at").notNull().defaultNow(),
    uninstalledAt: ts("uninstalled_at"),
  },
  (t) => [uniqueIndex("platform_connections_external_idx").on(t.platform, t.externalId), index("platform_connections_store_idx").on(t.storeId)],
);

/* ---------- Data protection (DPDP Act 2023) ---------- */

/** Every consent a person gives or withdraws, with the exact wording they saw. Append-only. */
export const consents = pgTable(
  "consents",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    /** The shopper's user id (or phone for people without an account). */
    subject: text("subject").notNull(),
    /** deal_contact | marketing | recovery_offers */
    purpose: text("purpose").notNull(),
    /** granted | withdrawn */
    action: text("action").notNull(),
    wording: text("wording").notNull(),
    source: text("source").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("consents_subject_idx").on(t.subject)],
);

/**
 * Complaints to the grievance officer (DPDP and Consumer Protection (E-Commerce) Rules): acknowledge
 * within 48 hours, resolve within a month.
 */
export const grievances = pgTable(
  "grievances",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    contact: text("contact").notNull(),
    /** order | data_privacy | seller | payment | other */
    category: text("category").notNull(),
    reference: text("reference"),
    message: text("message").notNull(),
    /** open → acknowledged → resolved */
    status: text("status").notNull().default("open"),
    response: text("response"),
    handledBy: text("handled_by"),
    acknowledgeBy: ts("acknowledge_by").notNull(),
    resolveBy: ts("resolve_by").notNull(),
    acknowledgedAt: ts("acknowledged_at"),
    resolvedAt: ts("resolved_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("grievances_status_idx").on(t.status)],
);

/**
 * Analytics warehouse: one row per store per IST day, rolled up nightly from negotiations (which leave
 * Redis after a week) and orders. Money in paise. Idempotent: a re-run replaces the day's row.
 */
export const storeDailyMetrics = pgTable(
  "store_daily_metrics",
  {
    day: date("day").notNull(),
    storeId: text("store_id").notNull(),
    orgId: text("org_id").notNull(),
    negotiations: integer("negotiations").notNull().default(0),
    agreed: integer("agreed").notNull().default(0),
    escalated: integer("escalated").notNull().default(0),
    humanApproved: integer("human_approved").notNull().default(0),
    humanRejected: integer("human_rejected").notNull().default(0),
    /** Sum of list prices and agreed prices over agreed deals: average discount = 1 - agreed / list. */
    listValue: bigint("list_value", { mode: "number" }).notNull().default(0),
    agreedValue: bigint("agreed_value", { mode: "number" }).notNull().default(0),
    totalRounds: integer("total_rounds").notNull().default(0),
    orders: integer("orders").notNull().default(0),
    gmv: bigint("gmv", { mode: "number" }).notNull().default(0),
    fees: bigint("fees", { mode: "number" }).notNull().default(0),
    refunds: bigint("refunds", { mode: "number" }).notNull().default(0),
    disputes: integer("disputes").notNull().default(0),
    computedAt: ts("computed_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.day, t.storeId] }), index("store_daily_metrics_org_idx").on(t.orgId, t.day)],
);

/**
 * Every ONDC message we send or receive, as sent: the buyer app's working state (search results, quotes,
 * orders are read back from here) and the log ONDC asks for in certification.
 */
export const ondcMessages = pgTable(
  "ondc_messages",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    transactionId: text("transaction_id").notNull(),
    messageId: text("message_id").notNull(),
    /** search | on_search | select | on_select | init | on_init | confirm | on_confirm | status | on_status | … */
    action: text("action").notNull(),
    direction: text("direction").notNull(), // out | in
    /** The other side: the gateway for search, otherwise the seller app's subscriber id. */
    counterparty: text("counterparty").notNull(),
    /** The GhostCart shopper who started it (user id), when known. */
    userId: text("user_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("ondc_messages_txn_idx").on(t.transactionId, t.action), index("ondc_messages_created_idx").on(t.createdAt)],
);

/** Expo push tokens from the mobile app, per signed-in shopper (buyer) or seller member (phone). */
export const pushTokens = pgTable(
  "push_tokens",
  {
    token: text("token").notNull(),
    /** buyer (user id) | member (phone). A phone signed in as both gets both kinds of notification. */
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    platform: text("platform").notNull(), // ios | android
    createdAt: ts("created_at").notNull().defaultNow(),
    lastSeen: ts("last_seen").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.token, t.actorType] }), index("push_tokens_actor_idx").on(t.actorType, t.actorId)],
);

/**
 * Append-only history of every negotiation: what happened, by whom, at which deal version. Feeds the
 * live event stream (/api/v1/sessions/:id/events) and outlives the deal's week in Redis.
 */
export const negotiationEvents = pgTable(
  "negotiation_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    dealId: text("deal_id").notNull(),
    /** The deal version this event produced. */
    version: integer("version").notNull(),
    /** started | offer | counter | hold | final | escalated | approved | rejected | countered | agreed | grant_issued | paid | address | ordered */
    type: text("type").notNull(),
    /** shopper | agent | seller | desk | system */
    actor: text("actor").notNull(),
    price: integer("price"),
    status: text("status").notNull(),
    message: text("message"),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [index("negotiation_events_deal_idx").on(t.dealId, t.id)],
);

/** Browser push subscriptions for seller members using the web dashboard (offers to approve). */
export const webPushSubscriptions = pgTable(
  "web_push_subscriptions",
  {
    endpoint: text("endpoint").primaryKey(),
    /** The member's verified phone. */
    phone: text("phone").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("web_push_phone_idx").on(t.phone)],
);

/**
 * GhostCart's monthly tax invoice to each seller for its platform fee (fees are earned when a payout is
 * released or a price grant is redeemed, so an issued invoice never needs reversing). Money in paise.
 */
export const feeInvoices = pgTable(
  "fee_invoices",
  {
    /** GC/2026-27/000001: sequential per financial year. */
    number: text("number").primaryKey(),
    fy: text("fy").notNull(),
    serial: integer("serial").notNull(),
    orgId: text("org_id").notNull(),
    storeId: text("store_id").notNull(),
    /** YYYY-MM (IST) the fees were earned in. */
    period: text("period").notNull(),
    sellerName: text("seller_name").notNull(),
    sellerGstin: text("seller_gstin"),
    sellerAddress: text("seller_address"),
    /** Two-digit GST state code of the place of supply (the seller's state). */
    placeOfSupply: text("place_of_supply"),
    taxable: bigint("taxable", { mode: "number" }).notNull(),
    cgst: bigint("cgst", { mode: "number" }).notNull(),
    sgst: bigint("sgst", { mode: "number" }).notNull(),
    igst: bigint("igst", { mode: "number" }).notNull(),
    total: bigint("total", { mode: "number" }).notNull(),
    lines: jsonb("lines").$type<{ ref: string; at: string; fee: number; gst: number }[]>().notNull(),
    issuedAt: ts("issued_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("fee_invoices_store_period_idx").on(t.storeId, t.period), uniqueIndex("fee_invoices_fy_serial_idx").on(t.fy, t.serial), index("fee_invoices_org_idx").on(t.orgId)],
);

/** One run of matching the payment aggregator's settlement report against the ledger for an IST day. */
export const reconciliationRuns = pgTable(
  "reconciliation_runs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    day: date("day").notNull(),
    gateway: text("gateway").notNull(),
    reportLines: integer("report_lines").notNull(),
    ledgerLines: integer("ledger_lines").notNull(),
    matched: integer("matched").notNull(),
    issues: integer("issues").notNull(),
    ranAt: ts("ran_at").notNull().defaultNow(),
  },
  (t) => [index("reconciliation_runs_day_idx").on(t.day)],
);

/** A difference between the report and the ledger; open until staff resolve it with a note. Paise. */
export const reconciliationIssues = pgTable(
  "reconciliation_issues",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    runId: bigint("run_id", { mode: "number" }).notNull(),
    day: date("day").notNull(),
    orderId: text("order_id").notNull(),
    /** hold | release | refund */
    kind: text("kind").notNull(),
    ledgerAmount: bigint("ledger_amount", { mode: "number" }).notNull(),
    gatewayAmount: bigint("gateway_amount", { mode: "number" }).notNull(),
    /** open | resolved */
    status: text("status").notNull().default("open"),
    note: text("note"),
    resolvedBy: text("resolved_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("reconciliation_issues_status_idx").on(t.status), uniqueIndex("reconciliation_issues_key_idx").on(t.day, t.orderId, t.kind)],
);

/* ---------- GhostCart Privilege: abandoned carts become private haggles ---------- */

/** How a store wants abandoned carts recovered. One row per store; absent means off. */
export const recoverySettings = pgTable("recovery_settings", {
  storeId: text("store_id")
    .primaryKey()
    .references(() => stores.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  /** Overrides the store's discount rules for recovery haggles; null means use them. */
  maxDiscountPct: doublePrecision("max_discount_pct"),
  autoApprovePct: doublePrecision("auto_approve_pct"),
  delayMinutes: integer("delay_minutes").notNull().default(60),
  /** email | whatsapp | voice, in the order to try. */
  channels: text("channels").array().notNull().default(sql`ARRAY['email']::text[]`),
  exitPrompt: boolean("exit_prompt").notNull().default(true),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/**
 * A shopper asked to hear when a product's listed price drops to their target (never about a seller's
 * private haggle limits). One live alert per shopper and product; expires after 60 days.
 */
export const priceAlerts = pgTable(
  "price_alerts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Whole rupees. */
    targetPrice: integer("target_price").notNull(),
    /** Listed price when the alert was set, for the message. */
    priceAtSet: integer("price_at_set").notNull(),
    /** sha256 of the token in the alert's stop link. */
    stopTokenHash: text("stop_token_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    firedAt: ts("fired_at"),
    stoppedAt: ts("stopped_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("price_alerts_product_idx").on(t.productId), uniqueIndex("price_alerts_live_idx").on(t.userId, t.productId).where(sql`fired_at is null and stopped_at is null`)],
);

/**
 * A shopper's cart on a store, captured with the seller's integration (widget, Shopify webhook, Woo
 * plugin) or brought by the shopper (Rescue my cart). Lines are product ids in this store with the
 * list price at capture time. Contact details are kept only with recovery consent.
 */
export const carts = pgTable(
  "carts",
  {
    id: text("id").primaryKey(),
    storeId: text("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    /** widget | shopify_checkout | woo_checkout | ghostcart_checkout | rescue */
    source: text("source").notNull(),
    /** The platform's own id (Shopify checkout token, Woo order id), unique per store and source. */
    externalRef: text("external_ref"),
    lines: jsonb("lines").$type<{ productId: string; quantity: number; unitPrice: number; title: string; image?: string }[]>().notNull(),
    subtotal: integer("subtotal").notNull(),
    /** Set when the shopper has a GhostCart account. */
    userId: text("user_id"),
    email: text("email"),
    phone: text("phone"),
    name: text("name"),
    /** When the shopper agreed to be sent a private offer about this cart (DPDP: purpose recovery_offers). */
    consentAt: ts("consent_at"),
    /** open → abandoned → invited → negotiating → recovered | expired | opted_out */
    status: text("status").notNull().default("open"),
    returnUrl: text("return_url"),
    dealId: text("deal_id"),
    lastActivityAt: ts("last_activity_at").notNull().defaultNow(),
    abandonedAt: ts("abandoned_at"),
    recoveredAt: ts("recovered_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("carts_store_status_idx").on(t.storeId, t.status),
    uniqueIndex("carts_external_idx").on(t.storeId, t.source, t.externalRef).where(sql`external_ref is not null`),
  ],
);

/** A private haggle invitation for a cart. The link token is stored hashed. */
export const cartInvites = pgTable(
  "cart_invites",
  {
    id: text("id").primaryKey(),
    cartId: text("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    /** link | email | whatsapp | voice */
    channel: text("channel").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    /** created → sent → opened → used | failed | expired */
    status: text("status").notNull().default("created"),
    error: text("error"),
    expiresAt: ts("expires_at").notNull(),
    sentAt: ts("sent_at"),
    openedAt: ts("opened_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("cart_invites_cart_idx").on(t.cartId)],
);
