import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PaytmHttpClient } from "../../src/providers/paytmHttpClient";
import { CatalogService } from "../../src/services/catalogService";
import { makeCatalog } from "../testSupport";

test("catalog resolves by symbol, security id, and search", async () => {
  const catalog = await makeCatalog("/tmp/mock-trader-catalog-service.json");

  expect(catalog.resolve("RELIANCE")?.securityId).toBe("3456");
  expect(catalog.resolve("13")?.symbol).toBe("NIFTY50");
  expect(catalog.search({ q: "rel", limit: 5 })[0]?.symbol).toBe("RELIANCE");
});

test("cached index rows are repaired before REST and socket resolution", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mock-trader-indices-"));
  try {
    const path = join(directory, "catalog.json");
    await writeFile(
      path,
      JSON.stringify([
        {
          instrumentKey: "NSE:EQUITY:13",
          securityId: "13",
          symbol: "",
          name: "NIFTY",
          exchange: "NSE",
          instrumentType: "I",
          scripType: "EQUITY",
          searchableText: "nifty",
        },
        {
          instrumentKey: "BSE:EQUITY:51",
          securityId: "51",
          symbol: "",
          name: "SENSEX",
          exchange: "BSE",
          instrumentType: "I",
          scripType: "EQUITY",
          searchableText: "sensex",
        },
      ]),
    );
    const catalog = new CatalogService({} as PaytmHttpClient, path, []);
    expect(await catalog.loadSnapshot()).toBe(true);
    expect(catalog.resolve("NSE:INDEX:13")?.symbol).toBe("NIFTY");
    expect(
      catalog.resolvePreference({ instrumentKey: "NSE:INDEX:13" }, "QUOTE"),
    ).toMatchObject({
      securityId: "13",
      exchangeType: "NSE",
      scripType: "INDEX",
    });
    // BSE rows in an older snapshot are dropped, not just hidden from search.
    expect(catalog.resolve("BSE:INDEX:51")).toBeNull();
    expect(catalog.resolve("51")).toBeNull();
    expect(catalog.count()).toBe(1);
    expect(catalog.chartSymbols()).toEqual([
      {
        instrumentKey: "NSE:INDEX:13",
        symbol: "NIFTY",
        name: "NIFTY",
        scripType: "INDEX",
      },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
