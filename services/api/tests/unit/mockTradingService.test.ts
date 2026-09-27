import { expect, test } from "bun:test";
import {
  DrizzleMockTradingService,
  HttpError,
} from "../../src/services/trading/mockTradingService";

interface AccountLockMethod {
  requireOwnedAccountForUpdate(
    userId: string,
    accountId: string,
    tx: unknown,
  ): Promise<{ id: string }>;
}

function buildAccountLockHarness(rows: Array<{ id: string }>) {
  const events: string[] = [];
  const query = {
    from() {
      events.push("from");
      return query;
    },
    where() {
      events.push("where");
      return query;
    },
    for(lock: string) {
      events.push(`for:${lock}`);
      return query;
    },
    async limit(value: number) {
      events.push(`limit:${value}`);
      return rows;
    },
  };
  const tx = {
    select() {
      events.push("select");
      return query;
    },
  };
  const service = new DrizzleMockTradingService(
    {} as ConstructorParameters<typeof DrizzleMockTradingService>[0],
    {} as ConstructorParameters<typeof DrizzleMockTradingService>[1],
    {} as ConstructorParameters<typeof DrizzleMockTradingService>[2],
  ) as unknown as AccountLockMethod;

  return { events, service, tx };
}

test("account mutations acquire a PostgreSQL row lock before reading state", async () => {
  const { events, service, tx } = buildAccountLockHarness([
    { id: "account-1" },
  ]);

  const account = await service.requireOwnedAccountForUpdate(
    "user-1",
    "account-1",
    tx,
  );

  expect(account.id).toBe("account-1");
  expect(events).toEqual(["select", "from", "where", "for:update", "limit:1"]);
});

test("account mutation locking preserves the owned-account not-found error", async () => {
  const { service, tx } = buildAccountLockHarness([]);

  try {
    await service.requireOwnedAccountForUpdate("user-1", "missing-account", tx);
    throw new Error("Expected the account lookup to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(404);
    expect((error as HttpError).error).toBe("ACCOUNT_NOT_FOUND");
  }
});
