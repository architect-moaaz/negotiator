import type { NextConfig } from "next";
import { securityHeaders } from "./security-headers";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders() }];
  },
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@ghostcart/core", "@ghostcart/db", "@ghostcart/agent", "@ghostcart/payments", "@ghostcart/channels"],
  // Embedded Postgres for local development loads its WebAssembly from node_modules.
  serverExternalPackages: ["@electric-sql/pglite"],
  partialPrefetching: true,
  // The WooCommerce plugin download zips these files at request time.
  outputFileTracingIncludes: { "/api/plugins/woocommerce": ["../../plugins/woocommerce/ghostcart/**/*"] },
  // Dev only: lets the dev server's assets load on 127.0.0.1 too (used to test the widget cross-origin).
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
