import { getQuote } from "./src/lib/market-data/quotes";

const quote = await getQuote("MSFT");
console.log(quote);