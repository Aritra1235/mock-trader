"use client";

import { ChartCandlestick, Minus, Plus, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { percent, price, signedPrice, tone } from "@/lib/format";
import { type Instrument, instrumentFrom, instrumentHref } from "@/lib/market";
import { useTrader } from "./trader-provider";

export function useInstrumentSearch(query: string, limit = 20) {
  const [results, setResults] = useState<Instrument[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      void apiClient
        .GET("/api/v1/market/instruments/search", {
          params: { query: { q, limit } },
        })
        .then(({ data }) => {
          if (!active) return;
          setResults(
            (data ?? [])
              .map(instrumentFrom)
              .filter((x): x is Instrument => x !== null),
          );
        })
        .catch(() => active && setResults([]))
        .finally(() => active && setLoading(false));
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, limit]);
  return { results, loading };
}

export function Watchlist() {
  const { watchlist, isWatched, toggleWatch, openTicket } = useTrader();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const { results, loading } = useInstrumentSearch(query);

  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        event.key === "/" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
      ) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", focus);
    return () => window.removeEventListener("keydown", focus);
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setQuery("");
      input.current?.blur();
      return;
    }
    if (!results.length) return;
    const current = results[cursor];
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => Math.min(c + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (event.key === "Enter" && current) {
      event.preventDefault();
      setQuery("");
      router.push(instrumentHref(current.instrumentKey));
    }
  };

  return (
    <div className="watchlist">
      <div className="watch-search">
        <Search size={15} aria-hidden="true" />
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search eg: infy, reliance bse"
          aria-label="Search instruments"
          autoComplete="off"
          spellCheck={false}
        />
        {query ? (
          <button
            type="button"
            className="icon-button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        ) : (
          <span className="watch-count num">{watchlist.length} / 50</span>
        )}
      </div>

      {query.trim() ? (
        <ul className="search-results" aria-label="Search results">
          {results.length === 0 && (
            <li className="watch-empty">
              {loading ? "Searching…" : "No matching instruments"}
            </li>
          )}
          {results.map((item, index) => {
            const watched = isWatched(item.instrumentKey);
            return (
              <li
                key={item.instrumentKey}
                className={`result-row ${index === cursor ? "cursor" : ""}`}
                onMouseEnter={() => setCursor(index)}
              >
                <Link
                  href={instrumentHref(item.instrumentKey)}
                  className="result-main"
                  onClick={() => setQuery("")}
                >
                  <span className="result-symbol">{item.symbol}</span>
                  <span className="result-name">{item.name}</span>
                </Link>
                <span className="exch">{item.exchange}</span>
                <span className="row-actions">
                  <button
                    type="button"
                    className="act act-buy"
                    onClick={() => openTicket(item, "buy")}
                    title="Buy"
                  >
                    B
                  </button>
                  <button
                    type="button"
                    className="act act-sell"
                    onClick={() => openTicket(item, "sell")}
                    title="Sell"
                  >
                    S
                  </button>
                  <button
                    type="button"
                    className={`act ${watched ? "act-on" : ""}`}
                    onClick={() => toggleWatch(item)}
                    title={
                      watched ? "Remove from watchlist" : "Add to watchlist"
                    }
                    aria-label={`${watched ? "Remove" : "Add"} ${item.symbol} ${watched ? "from" : "to"} watchlist`}
                  >
                    {watched ? <Minus size={13} /> : <Plus size={13} />}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="watch-rows" aria-label="Watchlist">
          {watchlist.length === 0 && (
            <li className="watch-empty">
              Your watchlist is empty. Search above to add scrips.
            </li>
          )}
          {watchlist.map((item) => (
            <WatchRow key={item.instrumentKey} item={item} />
          ))}
        </ul>
      )}
      <div className="watch-foot">
        <span>
          Press <kbd>/</kbd> to search
        </span>
        <span>Prices in ₹</span>
      </div>
    </div>
  );
}

function WatchRow({ item }: { item: Instrument }) {
  const { priceOf, openTicket, toggleWatch } = useTrader();
  const view = priceOf(item.instrumentKey);
  const direction = tone(view.change);
  return (
    <li className="watch-row">
      <Link href={instrumentHref(item.instrumentKey)} className="watch-symbol">
        <span className="watch-name">{item.symbol}</span>
        <span className="exch">{item.exchange}</span>
      </Link>
      <span className="watch-quote">
        <span className={`watch-ltp num ${direction}`}>
          {price(view.price)}
        </span>
        <span className={`watch-chg num ${direction}`}>
          {signedPrice(view.change)} ({percent(view.changePercent)})
        </span>
      </span>
      <span className="row-actions">
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
        <Link
          href={instrumentHref(item.instrumentKey)}
          className="act"
          title="Chart"
          aria-label={`${item.symbol} chart`}
        >
          <ChartCandlestick size={13} />
        </Link>
        <button
          type="button"
          className="act"
          onClick={() => toggleWatch(item)}
          title="Remove"
          aria-label={`Remove ${item.symbol} from watchlist`}
        >
          <Trash2 size={13} />
        </button>
      </span>
    </li>
  );
}
