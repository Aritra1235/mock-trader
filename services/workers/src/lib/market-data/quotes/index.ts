import { yahooFinance } from "../../yahoo";
import { putQuote } from "../../redis/quotes";
import type { CachedQuote } from "../../../types/quote";

async function getQuote(
  ticker: string
): Promise<CachedQuote> {
  try {
    const quote = await yahooFinance.quote(ticker);
    return await putQuote(ticker, quote);
  } catch (error) {
    console.error(`Error fetching quote for ${ticker}:`, error);
    throw error;
  }
}

export { getQuote };