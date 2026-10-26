/**
 * Seed the local dev database for the Maestro device flows (apps/mobile/.maestro): one live ZZ shop whose
 * owner signs in on the phone as the seller, with a ₹2,000 kettle. The agent takes offers down to 5% off
 * on its own (₹1,900); lower offers go to the seller to approve. Safe to run again.
 *
 * Run it with the web dev server stopped (it writes apps/web/.pglite), then start the server:
 *   pnpm --filter @ghostcart/web db:seed-mobile
 */
import { setPolicy } from "../src/lib/shop/policies";
import { createOrg } from "../src/lib/shop/orgs";
import { createProduct, getProductByRef } from "../src/lib/shop/products";
import { createStore, getStoreBySlug, updateStore } from "../src/lib/shop/stores";

if (process.env.DATABASE_URL || process.env.VERCEL_ENV) {
  console.error("Refusing: this seeds the local development database only (unset DATABASE_URL).");
  process.exit(1);
}
const SELLER_PHONE = "+919000003101";

let shop = await getStoreBySlug("zz-maestro-shop");
if (!shop) {
  const org = await createOrg({ name: "ZZ Maestro Co (Claude)", ownerPhone: SELLER_PHONE, ownerName: "ZZ Maestro Seller" });
  shop = await createStore({ orgId: org.id, name: "ZZ Maestro Shop", platform: "ghostcart_shop" });
}
shop = (await updateStore(shop.id, { status: "live", tier: "trusted" }))!;
await setPolicy(shop.id, "store", null, { maxDiscountPct: 10, autoApprovePct: 5 });
if (!(await getProductByRef(shop.id, "ZZMAESTRO-KETTLE"))) await createProduct(shop.id, { title: "ZZ Maestro Kettle", price: 2000, stock: 1000, sku: "ZZMAESTRO-KETTLE" });
console.log(`Seeded ${shop.slug} (seller ${SELLER_PHONE}) with "ZZ Maestro Kettle" at ₹2,000.`);
process.exit(0);
