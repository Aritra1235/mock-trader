import { yahooFinance } from "../../yahoo";
import type { Interval } from "../../../types/yahoo-finance";

async function getChartData(ticker: string, period1: Date, period2: Date, interval: Interval) {
  try {
    const chartData = await yahooFinance.chart(ticker, { period1, period2, interval });
    return chartData;
  } catch (error) {
    console.error(`Error fetching chart data for ${ticker}:`, error);
    throw error;
  }
}

export { getChartData };