import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { loadDatabaseEnv } from "../config/env";
import * as schema from "./schemas/schema";

const env = loadDatabaseEnv();

export const pool = new Pool({
  connectionString: env.url,
  max: env.poolMax,
});

export const db = drizzle({
  client: pool,
  schema,
});

export type Database = typeof db;
export { schema };
