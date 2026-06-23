import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // pgvector cần extension được tạo trước (xem db/init.sql / docker-compose).
  verbose: true,
  strict: true,
});
