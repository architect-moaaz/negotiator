import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The dev-mode "N" badge would show up on the projector during the pitch.
  devIndicators: false,
  // Kokoro's ONNX runtime ships native binaries that must load from node_modules, not the bundle.
  serverExternalPackages: [
    "kokoro-js",
    "@huggingface/transformers",
    "onnxruntime-node",
  ],
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
