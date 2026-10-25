import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@ghostcart/core", "@ghostcart/db"],
  // Embedded Postgres for local development loads its WebAssembly from node_modules.
  serverExternalPackages: ["@electric-sql/pglite"],
  partialPrefetching: true,
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
