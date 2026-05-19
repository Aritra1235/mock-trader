import { ChartRange } from "../types/chart";

export function resolveRange(range: ChartRange) {
  const now = new Date();

  const period2 = now;
  const period1 = new Date(now);

  switch (range) {
    case "1d":
      period1.setDate(now.getDate() - 1);
      break;

    case "5d":
      period1.setDate(now.getDate() - 5);
      break;

    case "1mo":
      period1.setMonth(now.getMonth() - 1);
      break;

    case "3mo":
      period1.setMonth(now.getMonth() - 3);
      break;

    case "6mo":
      period1.setMonth(now.getMonth() - 6);
      break;

    case "1y":
      period1.setFullYear(now.getFullYear() - 1);
      break;

    case "5y":
      period1.setFullYear(now.getFullYear() - 5);
      break;
    default:
      period1.setDate(now.getDate() - 1);
  }

  return {
    period1,
    period2,
  };
}
