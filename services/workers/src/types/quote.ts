export interface CachedQuote {
  symbol: string;
  shortName: string | null;

  price: number | null;
  change: number | null;
  changePercent: number | null;

  open: number | null;
  high: number | null;
  low: number | null;

  previousClose: number | null;
  volume: number | null;

  marketState: string | null;

  currency: string | null;
  exchange: string | null;

  updatedAt: number;
}
