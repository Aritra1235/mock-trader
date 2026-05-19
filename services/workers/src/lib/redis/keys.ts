import type { ChartInterval, ChartRange } from "../../types/chart";

const redisKeys = {
  quote: (ticker: string) =>
    `market:quote:${ticker.toUpperCase()}`,

  chart: (
    ticker: string,
    range: ChartRange,
    interval: ChartInterval
  ) =>
    `market:chart:${ticker.toUpperCase()}:${range}:${interval}`,
};

export default redisKeys;