"use client";

import type { VelaTheme } from "@luxalgo/vela";
import type { ChartCell, VelaWorkspace } from "@luxalgo/vela/workspace";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { percent, price, signedPrice, tone } from "@/lib/format";
import { type Instrument, instrumentFrom, instrumentHref } from "@/lib/market";
import { CHART_TIMEFRAMES, NseChartProvider } from "@/lib/nse-chart-provider";
import { useTheme } from "@/lib/theme";
import { ThemeToggle } from "../theme-toggle";
import { useTrackedQuotes, useTrader } from "../trader-provider";

// Canvas colours can't read CSS variables; resolve the page's palette instead.
function velaTheme(): VelaTheme {
  const root = getComputedStyle(document.documentElement);
  const color = (name: string) => root.getPropertyValue(name).trim();
  return {
    background: color("--surface"),
    textColor: color("--text-2"),
    gridColor: color("--border-soft"),
    borderColor: color("--border"),
    upColor: color("--up"),
    downColor: color("--down"),
    fontFamily: getComputedStyle(document.body).fontFamily,
  };
}

const bareTicker = (symbol: string) => symbol.replace(/^nse:/i, "");

export function TerminalScreen({ instrumentId }: { instrumentId: string }) {
  const { auth, userId, openTicket, priceOf, quoteOf, remember } = useTrader();
  const { theme } = useTheme();
  const host = useRef<HTMLDivElement>(null);
  const workspace = useRef<VelaWorkspace | null>(null);
  const [activeKey, setActiveKey] = useState(instrumentId);
  const [charted, setCharted] = useState<string[]>([]);
  const [instrument, setInstrument] = useState<Instrument | null>(null);
  const [symbol, setSymbol] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const provider = useMemo(() => new NseChartProvider(setCharted), []);
  useTrackedQuotes([activeKey, ...charted]);

  useEffect(() => {
    let active = true;
    void apiClient
      .GET("/api/v1/market/instruments/{id}", {
        params: { path: { id: activeKey } },
      })
      .then(({ data }) => {
        const next = data ? instrumentFrom(data) : null;
        if (!active) return;
        setFailed(!next);
        if (!next) return;
        setInstrument(next);
        // The chart is built once; later switches happen inside it.
        setSymbol((current) => current ?? next.symbol);
        remember([next]);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [activeKey, remember]);

  useEffect(() => {
    const element = host.current;
    if (!element || !symbol || !userId) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void import("@luxalgo/vela/workspace").then(({ VelaWorkspace }) => {
      if (disposed) return;
      const chart = new VelaWorkspace(element, {
        layout: "1",
        symbol: `nse:${symbol}`,
        timeframe: "D",
        timeframes: CHART_TIMEFRAMES,
        timezone: "Asia/Kolkata",
        live: true,
        theme: velaTheme(),
        providers: { nse: () => provider },
        persist: `mock-trader-terminal:${userId}`,
        autofocus: true,
      });
      workspace.current = chart;
      // The bar-close countdown runs through nights and weekends on this market.
      const hideCountdown = (cell: ChartCell | undefined) =>
        cell?.chart.renderer.applyConfig?.({
          priceScale: { countdown: false },
        });
      hideCountdown(chart.active);
      const offCell = chart.on("cell:created", ({ id }) =>
        hideCountdown(chart.cell(id)),
      );
      // A restored workspace comes back on its saved symbol; the link wins.
      if (bareTicker(chart.active.symbol) !== symbol) {
        chart.active.setSymbol(`nse:${symbol}`);
      }
      const follow = () => {
        void provider
          .instrumentKey(bareTicker(chart.active.symbol))
          .then((key) => {
            if (!key || disposed) return;
            setActiveKey(key);
            window.history.replaceState(
              null,
              "",
              `/markets/${encodeURIComponent(key)}/terminal`,
            );
          });
      };
      const offState = chart.on("state:changed", follow);
      const offActive = chart.on("cell:active", follow);
      cleanup = () => {
        offCell();
        offState();
        offActive();
        workspace.current = null;
        chart.destroy();
      };
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [symbol, userId, provider]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: repaint when the app theme flips
  useEffect(() => {
    workspace.current?.setTheme(velaTheme());
  }, [theme]);

  useEffect(() => {
    for (const key of charted) {
      const last = priceOf(key).price;
      if (last !== null) {
        provider.pushQuote(key, last, quoteOf(key)?.quote?.volume ?? null);
      }
    }
  }, [charted, priceOf, quoteOf, provider]);

  const view = priceOf(activeKey);

  if (failed && !instrument) {
    return (
      <div className="chart-terminal">
        <header className="chart-terminal-bar">
          <Link href="/markets" className="icon-button" aria-label="Back">
            <ArrowLeft size={16} />
          </Link>
          <span className="muted">
            {auth === "offline"
              ? "Cannot reach the trading API."
              : "This instrument is not available."}
          </span>
        </header>
      </div>
    );
  }

  return (
    <div className="chart-terminal">
      <header className="chart-terminal-bar">
        <Link
          href={instrumentHref(activeKey)}
          className="icon-button"
          aria-label="Exit terminal"
          title="Exit terminal"
        >
          <ArrowLeft size={16} />
        </Link>
        {instrument && (
          <div className="chart-terminal-quote">
            <strong>{instrument.symbol}</strong>
            <span className="tag tag-muted">{instrument.exchange}</span>
            <span className="num">{price(view.price)}</span>
            <span className={`num ${tone(view.change)}`}>
              {signedPrice(view.change)} ({percent(view.changePercent)})
            </span>
          </div>
        )}
        <div className="chart-terminal-actions">
          <button
            type="button"
            className="btn btn-buy btn-sm"
            disabled={!instrument || instrument.scripType === "INDEX"}
            onClick={() => instrument && openTicket(instrument, "buy")}
          >
            Buy
          </button>
          <button
            type="button"
            className="btn btn-sell btn-sm"
            disabled={!instrument || instrument.scripType === "INDEX"}
            onClick={() => instrument && openTicket(instrument, "sell")}
          >
            Sell
          </button>
          <ThemeToggle />
        </div>
      </header>
      <div ref={host} className="chart-terminal-host" />
    </div>
  );
}
