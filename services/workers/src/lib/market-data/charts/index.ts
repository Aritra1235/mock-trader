import { yahooFinance } from "../../yahoo";
import { putChart } from "../../redis/charts";
import type { ChartInterval, ChartRange, CachedChart } from "../../../types/chart";
import { resolveRange } from "./range-resolver";

async function getChart(
  ticker: string,
  range: ChartRange,
  interval: ChartInterval
): Promise<CachedChart> {
  try {
    const { period1, period2 } = resolveRange(range);

    const chartData = await yahooFinance.chart(ticker, {
      period1,
      period2,
      interval,
    });

    return await putChart(ticker, range, interval, chartData);
  } catch (error) {
    console.error(`Error fetching chart data for ${ticker}:`, error);
    throw error;
  }
}

export { getChart };