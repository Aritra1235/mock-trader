"use client";

import { Minus, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { percent, price, signedPrice, tone } from "@/lib/format";
import { type Instrument, instrumentHref } from "@/lib/market";
import { Empty, PageHeader } from "../bits";
import { resolveSymbol, useTrackedQuotes, useTrader } from "../trader-provider";
import { useInstrumentSearch } from "../watchlist";

const popular = [
  "RELIANCE",
  "HDFCBANK",
  "ICICIBANK",
  "INFY",
  "TCS",
  "SBIN",
  "BHARTIARTL",
  "ITC",
  "LT",
  "KOTAKBANK",
  "AXISBANK",
  "HINDUNILVR",
  "BAJFINANCE",
  "MARUTI",
  "SUNPHARMA",
];

type Exchange = "ALL" | "NSE" | "BSE";

export function MarketsScreen() {
  const [query, setQuery] = useState("");
  const [exchange, setExchange] = useState<Exchange>("ALL");
  const [featured, setFeatured] = useState<Instrument[] | null>(null);
  const { results, loading } = useInstrumentSearch(query, 40);

  useEffect(() => {
    let active = true;
    void Promise.all(
      popular.map((s) => resolveSymbol(s).catch(() => null)),
    ).then((items) => {
      if (active) setFeatured(items.filter((x): x is Instrument => x !== null));
    });
    return () => {
      active = false;
    };
  }, []);

  const searching = query.trim().length > 0;
  const rows = useMemo(
    () =>
      (searching ? results : (featured ?? [])).filter(
        (x) => exchange === "ALL" || x.exchange === exchange,
      ),
    [searching, results, featured, exchange],
  );
  useTrackedQuotes(rows.map((x) => x.instrumentKey));

  return (
    <div className="screen">
      <PageHeader
        title="Markets"
        meta="Search 90,000+ NSE and BSE instruments"
      />
      <div className="toolbar">
        <label className="search-box">
          <Search size={16} aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by symbol or company name"
            aria-label="Search by symbol or company name"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <fieldset className="segmented" aria-label="Exchange">
          {(["ALL", "NSE", "BSE"] as const).map((x) => (
            <button
              key={x}
              type="button"
              aria-pressed={exchange === x}
              className={exchange === x ? "on" : ""}
              onClick={() => setExchange(x)}
            >
              {x === "ALL" ? "All" : x}
            </button>
          ))}
        </fieldset>
      </div>

      <section className="panel flush">
        <div className="panel-head padded">
          <h2>
            {searching
              ? `Results for "${query.trim()}"`
              : "Most traded large caps"}
          </h2>
          <span className="muted small">{rows.length} instruments</span>
        </div>
        {rows.length === 0 ? (
          <Empty
            title={
              (searching && loading) || featured === null
                ? "Loading…"
                : "No instruments found"
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table table-hover">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Exchange</th>
                  <th className="r">LTP</th>
                  <th className="r">Chg.</th>
                  <th className="r">Chg. %</th>
                  <th className="r">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <MarketRow key={item.instrumentKey} item={item} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function MarketRow({ item }: { item: Instrument }) {
  const { priceOf, openTicket, isWatched, toggleWatch } = useTrader();
  const view = priceOf(item.instrumentKey);
  const watched = isWatched(item.instrumentKey);
  return (
    <tr>
      <td>
        <Link href={instrumentHref(item.instrumentKey)} className="cell-stack">
          <strong>{item.symbol}</strong>
          <span>{item.name}</span>
        </Link>
      </td>
      <td className="muted">{item.exchange}</td>
      <td className="r num">
        {price(view.price)}
        {view.source === "close" && (
          <span className="stale-mark" title="Last close">
            *
          </span>
        )}
      </td>
      <td className={`r num ${tone(view.change)}`}>
        {signedPrice(view.change)}
      </td>
      <td className={`r num ${tone(view.changePercent)}`}>
        {percent(view.changePercent)}
      </td>
      <td className="r">
        <span className="row-actions always">
          <button
            type="button"
            className="act act-buy"
            onClick={() => openTicket(item, "buy")}
            title={`Buy ${item.symbol}`}
          >
            B
          </button>
          <button
            type="button"
            className="act act-sell"
            onClick={() => openTicket(item, "sell")}
            title={`Sell ${item.symbol}`}
          >
            S
          </button>
          <button
            type="button"
            className={`act ${watched ? "act-on" : ""}`}
            onClick={() => toggleWatch(item)}
            title={watched ? "Remove from watchlist" : "Add to watchlist"}
            aria-label={`${watched ? "Remove" : "Add"} ${item.symbol} ${watched ? "from" : "to"} watchlist`}
          >
            {watched ? <Minus size={13} /> : <Plus size={13} />}
          </button>
        </span>
      </td>
    </tr>
  );
}
