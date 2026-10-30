import {
  afterEach,
  beforeEach,
  expect,
  setSystemTime,
  spyOn,
  test,
} from "bun:test";
import { apiClient } from "./api-client";
import { NseChartProvider } from "./nse-chart-provider";

const key = "NSE:EQUITY:2885";
const ist = (time) => Date.parse(`${time}+05:30`);
const candle = (time, close, volume = 100) => ({
  timestamp: ist(time),
  open: close,
  high: close,
  low: close,
  close,
  volume,
});

let bars;
let requested;

beforeEach(() => {
  bars = [];
  requested = [];
  spyOn(apiClient, "GET").mockImplementation((path, init) => {
    if (path === "/api/v1/market/symbols") {
      return Promise.resolve({
        data: [
          {
            instrumentKey: key,
            symbol: "RELIANCE",
            name: "Reliance Industries",
            scripType: "EQUITY",
          },
          {
            instrumentKey: "NSE:ETF:1",
            symbol: "NIFTYBEES",
            name: "Nifty Bees",
            scripType: "ETF",
          },
        ],
      });
    }
    const { query } = init.params;
    requested.push(query);
    return Promise.resolve({
      data: { timeframe: query.timeframe, bars },
    });
  });
});

afterEach(() => {
  setSystemTime();
});

const watching = async (timeframe, ticker = "RELIANCE") => {
  const provider = new NseChartProvider(() => {});
  await provider.getBars(ticker, timeframe, {});
  const emitted = [];
  provider.subscribe(ticker, timeframe, (bar) => emitted.push(bar));
  return { provider, emitted };
};

test("symbols are typed for the picker and resolved to instrument keys", async () => {
  const provider = new NseChartProvider(() => {});
  const symbols = await provider.listSymbols();

  expect(symbols.map((x) => x.type)).toEqual(["stock", "etf"]);
  expect(await provider.instrumentKey("RELIANCE")).toBe(key);
  expect(await provider.instrumentKey("MISSING")).toBeNull();
});

test("a failed symbol load can be retried", async () => {
  const get = spyOn(apiClient, "GET");
  get.mockImplementationOnce(() => Promise.resolve({}));
  const provider = new NseChartProvider(() => {});

  await expect(provider.listSymbols()).rejects.toThrow();
  expect(await provider.instrumentKey("RELIANCE")).toBe(key);
});

test("preset and alias timeframes map onto the API", async () => {
  const provider = new NseChartProvider(() => {});
  for (const timeframe of ["15", "60", "1h", "D", "1D", "W", "M"]) {
    await provider.getBars("RELIANCE", timeframe, { from: 1, to: 2 });
  }

  expect(requested.map((x) => x.timeframe)).toEqual([
    "15",
    "60",
    "60",
    "D",
    "D",
    "W",
    "M",
  ]);
});

test("custom minute timeframes regroup from the session open", async () => {
  bars = [
    candle("2026-10-30T09:15:00", 100, 10),
    candle("2026-10-30T10:15:00", 110, 20),
    candle("2026-10-30T13:15:00", 90, 30),
  ];
  const provider = new NseChartProvider(() => {});

  const grouped = await provider.getBars("RELIANCE", "240", {});

  expect(requested[0].timeframe).toBe("60");
  expect(grouped.map((bar) => bar.time)).toEqual([
    ist("2026-10-30T09:15:00"),
    ist("2026-10-30T13:15:00"),
  ]);
  expect(grouped[0]).toMatchObject({ close: 110, volume: 30, high: 110 });
});

test("unsupported instruments and timeframes return no bars", async () => {
  const provider = new NseChartProvider(() => {});

  expect(await provider.getBars("MISSING", "D", {})).toEqual([]);
  expect(await provider.getBars("RELIANCE", "1S", {})).toEqual([]);
  expect(requested).toHaveLength(0);
});

test("a live quote updates the forming bar, then starts the next one", async () => {
  setSystemTime(new Date("2026-10-30T10:02:00+05:30"));
  bars = [candle("2026-10-30T10:00:00", 100, 500)];
  const { provider, emitted } = await watching("5");

  provider.pushQuote(key, 104, 1_000);
  provider.pushQuote(key, 96, 1_040);
  setSystemTime(new Date("2026-10-30T10:06:00+05:30"));
  provider.pushQuote(key, 98, 1_100);

  expect(emitted[1]).toMatchObject({
    time: ist("2026-10-30T10:00:00"),
    open: 100,
    high: 104,
    low: 96,
    close: 96,
    volume: 540,
  });
  expect(emitted[2]).toMatchObject({
    time: ist("2026-10-30T10:05:00"),
    open: 98,
    close: 98,
    volume: 60,
  });
});

test("hourly bars line up with the 09:15 open", async () => {
  setSystemTime(new Date("2026-10-30T10:20:00+05:30"));
  bars = [candle("2026-10-30T09:15:00", 100)];
  const { provider, emitted } = await watching("60");

  provider.pushQuote(key, 101, null);

  expect(emitted[0].time).toBe(ist("2026-10-30T10:15:00"));
});

test("daily, weekly and monthly forming bars keep their IST anchors", async () => {
  setSystemTime(new Date("2026-10-29T10:00:00+05:30"));
  for (const [timeframe, start] of [
    ["D", "2026-10-29T00:00:00"],
    ["W", "2026-10-26T00:00:00"],
    ["M", "2026-10-01T00:00:00"],
  ]) {
    bars = [candle(start, 100)];
    const { provider, emitted } = await watching(timeframe);

    provider.pushQuote(key, 101, null);

    expect(emitted[0]).toMatchObject({ time: ist(start), close: 101 });
  }
});

test("quotes are ignored outside the session and for other instruments", async () => {
  setSystemTime(new Date("2026-10-30T22:00:00+05:30"));
  const { provider, emitted } = await watching("D");

  provider.pushQuote(key, 101, null);
  setSystemTime(new Date("2026-10-30T10:00:00+05:30"));
  provider.pushQuote("NSE:EQUITY:1", 101, null);

  expect(emitted).toEqual([]);
});

test("the app is told which instruments need quotes", async () => {
  const keys = [];
  const provider = new NseChartProvider((next) => keys.push(next));
  await provider.listSymbols();

  const stop = provider.subscribe("RELIANCE", "D", () => {});
  provider.subscribe("RELIANCE", "5", () => {});
  stop();

  expect(keys).toEqual([[key], [key], [key]]);
});
