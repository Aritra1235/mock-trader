import { resolve } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { log } from "../lib/log";
import { db, pool } from "./index";

const migrationsFolder = resolve(import.meta.dir, "..", "..", "drizzle");

try {
  await migrate(db, { migrationsFolder });
  log.info("database migrations applied", { folder: migrationsFolder });
} finally {
  await pool.end();
}
