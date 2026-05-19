import redisClient from "..";
import config from "../../../config";
import redisKeys from "../keys";
import type {
  CachedChart,
  ChartInterval,
  ChartRange,
  Candle,
} from "../../../types/chart";

async function putChart(
  ticker: string,
  range: ChartRange,
  interval: ChartInterval,
  chartData: any
): Promise<CachedChart> {
  const key = redisKeys.chart(
    ticker,
    range,
    interval
  );

  // normalize candles
  const candles: Candle[] =
    chartData.quotes?.map((candle: any): Candle => ({
      timestamp: candle.date
        ? new Date(candle.date).getTime()
        : 0,

      open: candle.open ?? null,
      high: candle.high ?? null,
      low: candle.low ?? null,
      close: candle.close ?? null,
      volume: candle.volume ?? null,
    })) ?? [];

  const normalizedChart: CachedChart = {
    symbol: ticker.toUpperCase(),
    range,
    interval,

    currency:
      chartData.meta?.currency ?? null,

    exchange:
      chartData.meta?.exchangeName ?? null,

    timezone:
      chartData.meta?.exchangeTimezoneName ??
      null,

    previousClose:
      chartData.meta?.previousClose ?? null,

    candles,

    updatedAt: Date.now(),
  };

  await redisClient.set(
    key,
    JSON.stringify(normalizedChart),
    "EX",
    config.ttl.charts
  );

  // optional websocket pubsub
  await redisClient.publish(
    `pubsub:chart:${ticker.toUpperCase()}`,
    JSON.stringify({
      symbol: ticker.toUpperCase(),
      range,
      interval,
    })
  );

  return normalizedChart;
}

async function getCachedChart(
  ticker: string,
  range: ChartRange,
  interval: ChartInterval
): Promise<CachedChart | null> {
  const key = redisKeys.chart(
    ticker,
    range,
    interval
  );

  const data = await redisClient.get(key);

  if (!data) {
    return null;
  }

  return JSON.parse(data) as CachedChart;
}

export { putChart, getCachedChart };