"use client";

import { Minus, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiClient } from "@/lib/api-client";
import {
  clock,
  percent,
  price,
  quantity,
  rupees,
  signedPrice,
  stamp,
  tone,
} from "@/lib/format";
import { type Instrument, instrumentFrom, num } from "@/lib/market";
import { Empty } from "../bits";
import { type Candle, PriceChart } from "../price-chart";
import { useTrackedQuotes, useTrader } from "../trader-provider";

type Range = "5d" | "1mo" | "6mo" | "1y";
const ranges: { key: Range; label: string }[] = [
  { key: "5d", label: "5D" },
  { key: "1mo", label: "1M" },
  { key: "6mo", label: "6M" },
  { key: "1y", label: "1Y" },
];

export function InstrumentScreen({ instrumentId }: { instrumentId: string }) {
  const { remember } = useTrader();
  const [instrument, setInstrument] = useState<Instrument | null>(null);
  const [status, setStatus] = useState<
    "loading" | "ready" | "not-found" | "error"
  >("loading");
  useTrackedQuotes([instrumentId]);

  useEffect(() => {
    let active = true;
    setStatus("loading");
    setInstrument(null);
    void apiClient
      .GET("/api/v1/market/instruments/{id}", {
        params: { path: { id: instrumentId } },
      })
      .then(({ data, response }) => {
        if (!active) return;
        const item = instrumentFrom(data);
        setInstrument(item);
        if (item) remember([item]);
        setStatus(
          item ? "ready" : response.status === 404 ? "not-found" : "error",
        );
      })
      .catch(() => active && setStatus("error"));
    return () => {
      active = false;
    };
  }, [instrumentId, remember]);

  if (!instrument)
    return (
      <div className="screen">
        <section className="panel">
          <Empty
            title={
              status === "loading"
                ? "Loading instrument…"
                : status === "not-found"
                  ? "Instrument not found"
                  : "Instrument unavailable"
            }
          >
            {status !== "loading" && (
              <Link href="/markets" className="link">
                Back to markets
              </Link>
            )}
          </Empty>
        </section>
      </div>
    );
  return <InstrumentView instrument={instrument} />;
}

function InstrumentView({ instrument }: { instrument: Instrument }) {
  const {
    priceOf,
    quoteOf,
    closeOf,
    openTicket,
    isWatched,
    toggleWatch,
    positions,
  } = useTrader();
  const key = instrument.instrumentKey;
  const view = priceOf(key);
  const quote = quoteOf(key)?.quote;
  const ref = closeOf(key);
  const watched = isWatched(key);
  // Delivery and intraday positions in the same stock are listed separately.
  const holdings = positions.filter((p) => p.instrumentId === key);
  const [range, setRange] = useState<Range>("5d");
  const [history, setHistory] = useState<{
    status: "loading" | "ready" | "error";
    candles: Candle[];
    interval: "15m" | "1d" | "1w";
  }>({ status: "loading", candles: [], interval: "15m" });

  useEffect(() => {
    let active = true;
    setHistory((h) => ({ ...h, status: "loading" }));
    void apiClient
      .GET("/api/v1/market/instruments/{id}/history", {
        params: { path: { id: key }, query: { range } },
      })
      .then(({ data }) => {
        if (!active) return;
        if (!data?.bars?.length) throw new Error("empty");
        setHistory({
          status: "ready",
          candles: data.bars,
          interval: data.interval,
        });
      })
      .catch(
        () =>
          active &&
          setHistory({ status: "error", candles: [], interval: "15m" }),
      );
    return () => {
      active = false;
    };
  }, [key, range]);

  // Without a live quote, summarise the most recent session from the loaded candles.
  const session = useMemo(() => {
    const bars = history.candles;
    const last = bars.at(-1);
    if (!last) return null;
    const day = new Date(last.timestamp + 330 * 60_000)
      .toISOString()
      .slice(0, 10);
    const sameDay = bars.filter(
      (b) =>
        new Date(b.timestamp + 330 * 60_000).toISOString().slice(0, 10) === day,
    );
    return {
      open: sameDay[0]?.open ?? null,
      high: Math.max(...sameDay.map((b) => b.high)),
      low: Math.min(...sameDay.map((b) => b.low)),
      volume: sameDay.reduce((t, b) => t + b.volume, 0),
      at: last.timestamp,
    };
  }, [history.candles]);

  const live = view.source === "live";
  const stats = [
    ["Open", live ? quote?.ohlc?.open : session?.open],
    ["High", live ? quote?.ohlc?.high : session?.high],
    ["Low", live ? quote?.ohlc?.low : session?.low],
    ["Prev. close", live ? quote?.ohlc?.close : ref?.previousClose],
  ] as const;
  const volume = live ? quote?.volume : session?.volume;
  // The catalog's circuit band is from its snapshot day; if the previous
  // close falls outside it, it's out of date (the API ignores it too).
  const prevClose = num(live ? quote?.ohlc?.close : ref?.previousClose);
  const bandStale =
    prevClose !== null &&
    ((instrument.lowerLimit != null && prevClose < instrument.lowerLimit) ||
      (instrument.upperLimit != null && prevClose > instrument.upperLimit));

  return (
    <div className="screen">
      <div className="quote-header">
        <div>
          <div className="quote-symbol">
            <h1>{instrument.symbol}</h1>
            <span className="tag tag-muted">{instrument.exchange}</span>
            {instrument.scripType && (
              <span className="tag tag-muted">{instrument.scripType}</span>
            )}
          </div>
          <div className="quote-name">{instrument.name}</div>
          <div className="quote-price">
            <span className="ltp num">{price(view.price)}</span>
            <span className={`num ${tone(view.change)}`}>
              {signedPrice(view.change)} ({percent(view.changePercent)})
            </span>
          </div>
          <div className="quote-asof">
            {view.source === "live" && quote?.receivedAt
              ? `Live · ${clock(quote.receivedAt)}`
              : view.source === "stale"
                ? "Delayed quote"
                : view.source === "close" && ref
                  ? `Last close · ${stamp(new Date(ref.at).toISOString())} · live quote unavailable`
                  : "Waiting for quote"}
          </div>
        </div>
        <div className="quote-actions">
          <button
            type="button"
            className="btn btn-buy btn-lg"
            onClick={() => openTicket(instrument, "buy")}
          >
            Buy
          </button>
          <button
            type="button"
            className="btn btn-sell btn-lg"
            onClick={() => openTicket(instrument, "sell")}
          >
            Sell
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-lg"
            onClick={() => toggleWatch(instrument)}
            aria-label={watched ? "Remove from watchlist" : "Add to watchlist"}
            title={watched ? "Remove from watchlist" : "Add to watchlist"}
          >
            {watched ? <Minus size={16} /> : <Plus size={16} />}
            Watchlist
          </button>
        </div>
      </div>

      <div className="stat-row">
        {stats.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong className="num">{price(value)}</strong>
          </div>
        ))}
        <div>
          <span>Volume</span>
          <strong className="num">{quantity(volume)}</strong>
        </div>
        <div>
          <span>Lower circuit</span>
          <strong className="num">
            {price(bandStale ? null : instrument.lowerLimit)}
          </strong>
        </div>
        <div>
          <span>Upper circuit</span>
          <strong className="num">
            {price(bandStale ? null : instrument.upperLimit)}
          </strong>
        </div>
        <div>
          <span>Lot size</span>
          <strong className="num">{quantity(instrument.lotSize ?? 1)}</strong>
        </div>
      </div>

      <section className="panel flush chart-panel">
        <div className="chart-toolbar">
          <fieldset className="segmented small" aria-label="Chart range">
            {ranges.map((r) => (
              <button
                key={r.key}
                type="button"
                aria-pressed={range === r.key}
                className={range === r.key ? "on" : ""}
                onClick={() => setRange(r.key)}
              >
                {r.label}
              </button>
            ))}
          </fieldset>
          <span className="muted small">
            {history.interval === "15m" ? "15 min" : "Daily"} candles · MA ·
            Volume
          </span>
        </div>
        {history.status === "ready" ? (
          <PriceChart
            symbol={instrument.symbol}
            candles={history.candles}
            interval={history.interval}
          />
        ) : (
          <div className="chart-canvas chart-placeholder">
            {history.status === "loading"
              ? "Loading chart…"
              : "Price history is unavailable right now."}
          </div>
        )}
      </section>

      {holdings.map((holding) => (
        <section className="panel" key={holding.id}>
          <div className="panel-head">
            <h2>
              Your position
              {holding.product === "intraday" && (
                <span
                  className="product-mark"
                  title="Squared off automatically at 3:20 pm IST"
                >
                  MIS
                </span>
              )}
            </h2>
            <Link href="/portfolio" className="link small">
              Holdings
            </Link>
          </div>
          <dl className="kv kv-row">
            <div>
              <dt>Quantity</dt>
              <dd className="num">{quantity(holding.quantity)}</dd>
            </div>
            <div>
              <dt>Avg. cost</dt>
              <dd className="num">{price(holding.averageCost)}</dd>
            </div>
            <div>
              <dt>Current value</dt>
              <dd className="num">
                {rupees(
                  view.price !== null
                    ? view.price * (num(holding.quantity) ?? 0)
                    : holding.marketValue,
                )}
              </dd>
            </div>
            <div>
              <dt>P&amp;L</dt>
              {(() => {
                const qty = num(holding.quantity) ?? 0;
                const pnl =
                  view.price !== null
                    ? (view.price - (num(holding.averageCost) ?? 0)) * qty
                    : num(holding.unrealizedPnl);
                return (
                  <dd className={`num ${tone(pnl)}`}>{signedPrice(pnl)}</dd>
                );
              })()}
            </div>
          </dl>
        </section>
      ))}
    </div>
  );
}
