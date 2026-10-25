import { randomBytes } from "node:crypto";
import type { Product } from "../shop/products";
import type { Store } from "../shop/stores";

/**
 * How an agreed price is honoured on a seller's own platform. Each adapter creates a single-use
 * discount code locked to one product, worth exactly (list price − agreed price), that expires.
 */
export interface GrantAdapter {
  platform: string;
  /** Can this store take a grant right now (e.g. the app is still installed)? Defaults to yes. */
  ready?(store: Store): Promise<boolean>;
  createGrant(input: { store: Store; product: Product; code: string; discountInr: number; expiresAt: Date }): Promise<{ checkoutUrl: string }>;
}

export const GRANT_PLATFORMS = new Set(["shopify", "woocommerce"]);

/** "GC-7K2Q9M": short enough to read out, unambiguous characters only. */
export function grantCode() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = randomBytes(8);
  return `GC-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")}`;
}

/** Development stand-in: pretends the code was created and links to the store's cart. */
const mock: GrantAdapter = {
  platform: "mock",
  async createGrant({ store, code }) {
    return { checkoutUrl: `https://${store.domain ?? "example.com"}/cart?discount=${encodeURIComponent(code)}` };
  },
};

const registry = new Map<string, GrantAdapter>();

/** Platform integrations register themselves (Shopify, WooCommerce). */
export function registerGrantAdapter(platform: string, adapter: GrantAdapter) {
  registry.set(platform, adapter);
}

/** The adapter for a store, or null when the store's platform isn't connected (production) yet. */
export async function grantAdapterFor(store: Store): Promise<GrantAdapter | null> {
  await import("./registry"); // platform adapters register on import
  const adapter = registry.get(store.platform);
  if (adapter) return !adapter.ready || (await adapter.ready(store)) ? adapter : null;
  return process.env.VERCEL_ENV === "production" ? null : mock;
}
