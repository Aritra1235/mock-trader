import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { user } from "../src/db/schemas/schema";
import { auth } from "../src/lib/auth";
import { DrizzleMockTradingService } from "../src/services/trading/mockTradingService";

if (process.env.NODE_ENV === "production") {
  throw new Error("The demo seed is disabled in production.");
}

const email = process.env.DEMO_USER_EMAIL ?? "trader@example.test";
const password = process.env.DEMO_USER_PASSWORD;
if (!password || password.length < 8) {
  throw new Error("DEMO_USER_PASSWORD must contain at least 8 characters.");
}

let [demoUser] = await db
  .select()
  .from(user)
  .where(eq(user.email, email))
  .limit(1);
if (!demoUser) {
  await auth.api.signUpEmail({
    body: { email, password, name: "Demo Trader" },
  });
  [demoUser] = await db
    .select()
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
}
if (!demoUser) {
  throw new Error("Better Auth did not create the demo user.");
}

if (!demoUser.emailVerified) {
  [demoUser] = await db
    .update(user)
    .set({ emailVerified: true, updatedAt: new Date() })
    .where(eq(user.id, demoUser.id))
    .returning();
}

const trading = new DrizzleMockTradingService(
  {} as ConstructorParameters<typeof DrizzleMockTradingService>[0],
  {} as ConstructorParameters<typeof DrizzleMockTradingService>[1],
);
const provisioned = await trading.ensurePracticeAccount(demoUser.id);

console.info({ email, provisioned }, "Demo user ready");
await pool.end();
