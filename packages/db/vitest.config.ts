import { defineConfig } from "vitest/config";

// Each test boots an embedded Postgres and applies every migration; under a parallel `pnpm check` that
// takes well over the 5s default.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 30_000 } });
