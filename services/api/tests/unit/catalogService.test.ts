import { expect, test } from "bun:test";
import { makeCatalog } from "../testSupport";

test("catalog resolves by symbol, security id, and search", async () => {
  const catalog = await makeCatalog("/tmp/mock-trader-catalog-service.json");

  expect(catalog.resolve("RELIANCE")?.securityId).toBe("3456");
  expect(catalog.resolve("13")?.symbol).toBe("NIFTY50");
  expect(catalog.search({ q: "rel", limit: 5 })[0]?.symbol).toBe("RELIANCE");
});
