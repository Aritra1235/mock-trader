import { resolve } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index";

const migrationsFolder = resolve(import.meta.dir, "..", "..", "drizzle");

try {
  await migrate(db, { migrationsFolder });
  console.log(`Database migrations applied from ${migrationsFolder}`);
} finally {
  await pool.end();
}
