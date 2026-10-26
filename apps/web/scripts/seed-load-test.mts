/**
 * Seed a staging deployment for the k6 load tests (load/README.md): one live ZZ shop with products, a
 * widget key, and ZZ shopper accounts with ready sessions. Writes load/k6/.seed.json (gitignored).
 *
 *   ALLOW_LOAD_SEED=1 pnpm --filter @ghostcart/web db:seed-load -- --buyers 300 --origin https://zz-load.example
 *
 * Point it at staging's DATABASE_URL and Redis (KV_REST_API_*) with STORE_MODE matching staging.
 * Refuses on Vercel production. Everything it creates is named "ZZ Load …" so it can be found and removed.
 */
import { writeFileSync } from "node:fs";
import { createApiKey } from "../src/lib/integrations/keys";
import { issueSessionToken } from "../src/lib/session";
import { createOrg } from "../src/lib/shop/orgs";
import { setPolicy } from "../src/lib/shop/policies";
import { createProduct } from "../src/lib/shop/products";
import { createStore, updateStore } from "../src/lib/shop/stores";
import { store } from "../src/lib/store";

if (process.env.ALLOW_LOAD_SEED !== "1" || process.env.VERCEL_ENV === "production") {
  console.error("Refusing: set ALLOW_LOAD_SEED=1, and never run this against production.");
  process.exit(1);
}
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const buyers = Number(arg("buyers", "200"));
const origin = arg("origin", "https://zz-load.example");
const run = Date.now().toString(36);

// These numbers look like real mobiles, so nothing may ever call or message them: staging must run with Vobiz,
// Meta and payments in test mode, and the k6 haggle never offers below the auto-approve limit (8% here), so no
// approval call is ever placed to the owner.
const org = await createOrg({ name: `ZZ Load ${run}`, ownerPhone: `+9191110${String(Date.now()).slice(-5)}`, ownerName: "ZZ Load Owner" });
const shop = (await updateStore((await createStore({ orgId: org.id, name: `ZZ Load Shop ${run}`, platform: "ghostcart_shop" })).id, { status: "live", tier: "trusted" }))!;
await setPolicy(shop.id, "store", null, { maxDiscountPct: 15, autoApprovePct: 8 });
const productIds: string[] = [];
for (let i = 1; i <= 20; i++) productIds.push((await createProduct(shop.id, { title: `ZZ Load Item ${i}`, price: 500 + i * 250, stock: 1_000_000, sku: `ZZLOAD-${i}` })).id);
const { value: widgetKey } = await createApiKey(shop, "publishable", "load-seed", [origin]);

const tokens: string[] = [];
for (let i = 0; i < buyers; i++) {
  const phone = `+9191119${String(i).padStart(5, "0")}`;
  const { user } = await store.upsertUser({ id: crypto.randomUUID(), name: `ZZ Load Shopper ${i}`, phone, channel: "web", createdAt: Date.now(), consentAt: Date.now() });
  tokens.push(await issueSessionToken("buyer", user.id));
}

writeFileSync(
  new URL("../../../load/k6/.seed.json", import.meta.url),
  JSON.stringify({ createdAt: new Date().toISOString(), slug: shop.slug, storeId: shop.id, productIds, skus: productIds.map((_, i) => `ZZLOAD-${i + 1}`), widgetKey, origin, buyerTokens: tokens }, null, 2),
);
console.log(`Seeded ${shop.slug}: ${productIds.length} products, ${tokens.length} shoppers. Wrote load/k6/.seed.json`);
process.exit(0);
