import { yahooFinance } from "../../yahoo";


async function getQuote(ticker: string) {
  try {
    const quote = await yahooFinance.quote(ticker);
    return quote;
  } catch (error) {
    console.error(`Error fetching quote for ${ticker}:`, error);
    throw error;
  }
}

export { getQuote };