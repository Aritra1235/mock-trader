import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to run Drizzle commands");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schemas/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
