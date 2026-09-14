import type { Config } from "drizzle-kit";

export default {
  schema: "./schema.ts",
  out: "./migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL || "dev.db",
  },
} satisfies Config;
