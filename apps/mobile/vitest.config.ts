import { defineConfig } from "vitest/config";

// Unit tests for the app's pure logic (src/lib); screens are checked on a device or the web preview.
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
