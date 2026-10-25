import { defineConfig } from "drizzle-kit";

// `pnpm db:generate` needs no database. `pnpm db:migrate` applies ./drizzle to DATABASE_URL
// (use the direct, unpooled Neon URL for migrations).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "" },
  strict: true,
});
