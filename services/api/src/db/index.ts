import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { loadEnv } from "../config/env";

const env = loadEnv();

export const pool = new Pool({
  connectionString: env.db.url,
  max: env.db.poolMax,
});

export const db = drizzle({
  client: pool,
});

export type Database = typeof db;
