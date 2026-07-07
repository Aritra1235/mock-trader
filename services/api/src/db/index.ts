import { drizzle } from "drizzle-orm/node-postgres";
import { defineRelations } from "drizzle-orm/relations";
import { Pool } from "pg";
import { loadDatabaseEnv } from "../config/env";
import * as schema from "./schema";

const env = loadDatabaseEnv();

export const pool = new Pool({
  connectionString: env.url,
  max: env.poolMax,
});

const relations = defineRelations(schema);

export const db = drizzle({
  client: pool,
  relations,
});

export type Database = typeof db;
export { relations, schema };
