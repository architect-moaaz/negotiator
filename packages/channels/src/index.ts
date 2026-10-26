/**
 * Channel adapters' shared, platform-level pieces: the common message shape, Meta Graph and webhook
 * signatures, Shopify OAuth and webhook HMACs. App-specific wiring (stores, sessions) stays in apps/web.
 */
export * from "./types";
export * from "./meta";
export * from "./shopify";
export * from "./shopify-config";
