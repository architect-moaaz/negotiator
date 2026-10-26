import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Tests run on an embedded Postgres, often alongside `next build` in CI; the 5s default is too tight there.
  test: { setupFiles: ["./vitest.setup.ts"], testTimeout: 30_000, hookTimeout: 30_000 },
});
