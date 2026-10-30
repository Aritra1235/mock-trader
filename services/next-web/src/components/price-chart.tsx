"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "@/lib/theme";

export type Candle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const palettes = {
  light: {
    up: "#089a6c",
    down: "#e0404d",
    grid: "#f0f2f5",
    axis: "#e3e6eb",
    text: "#808898",
    crosshair: "#9aa1ab",
    label: "#3d4450",
    upBar: "rgba(8, 154, 108, 0.4)",
    downBar: "rgba(224, 64, 77, 0.4)",
    flatBar: "rgba(124, 132, 144, 0.45)",
  },
  dark: {
    up: "#1fc28b",
    down: "#ff5c69",
    grid: "#111111",
    axis: "#1c1c1c",
    text: "#6c7483",
    crosshair: "#5b636f",
    label: "#2a2a2a",
    upBar: "rgba(31, 194, 139, 0.35)",
    downBar: "rgba(255, 92, 105, 0.35)",
    flatBar: "rgba(127, 135, 148, 0.4)",
  },
};

export function PriceChart({
  symbol,
  candles,
  interval,
}: {
  symbol: string;
  candles: Candle[];
  interval: "15m" | "1d" | "1w";
}) {
  const container = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!container.current || candles.length === 0) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void import("klinecharts").then(({ init, dispose }) => {
      if (disposed || !container.current) return;
      const element = container.current;
      const { up, down, grid, axis, text, crosshair, label, ...bars } =
        palettes[theme];
      // Canvas text can't read CSS variables; resolve the page font once.
      const family = getComputedStyle(document.body).fontFamily;
      const font = { family, size: 11 };
      const chart = init(element, {
        styles: {
          grid: {
            horizontal: { color: grid },
            vertical: { color: grid },
          },
          candle: {
            bar: {
              upColor: up,
              downColor: down,
              noChangeColor: text,
              upBorderColor: up,
              downBorderColor: down,
              noChangeBorderColor: text,
              upWickColor: up,
              downWickColor: down,
              noChangeWickColor: text,
            },
            priceMark: {
              high: { color: text },
              low: { color: text },
              last: {
                upColor: up,
                downColor: down,
                noChangeColor: text,
              },
            },
            tooltip: {
              title: { show: false },
              legend: { color: text, ...font },
            },
          },
          indicator: {
            bars: [
              {
                upColor: bars.upBar,
                downColor: bars.downBar,
                noChangeColor: bars.flatBar,
              },
            ],
            lines: [
              { color: "#e8a33d" },
              { color: "#8e5bd1" },
              { color: "#2c6ae0" },
              { color: "#cf4a86" },
            ],
            tooltip: {
              title: { color: text, ...font },
              legend: { color: text, ...font },
            },
          },
          xAxis: {
            axisLine: { color: axis },
            tickLine: { color: axis },
            tickText: { color: text, ...font },
          },
          yAxis: {
            axisLine: { color: axis },
            tickLine: { color: axis },
            tickText: { color: text, ...font },
          },
          separator: { color: axis },
          crosshair: {
            horizontal: {
              line: { color: crosshair },
              text: {
                backgroundColor: label,
                borderColor: label,
                family,
              },
            },
            vertical: {
              line: { color: crosshair },
              text: {
                backgroundColor: label,
                borderColor: label,
                family,
              },
            },
          },
        },
      });
      if (!chart) return;
      chart.setSymbol({
        ticker: symbol,
        pricePrecision: 2,
        volumePrecision: 0,
      });
      chart.setPeriod(
        interval === "15m"
          ? { span: 15, type: "minute" }
          : interval === "1w"
            ? { span: 1, type: "week" }
            : { span: 1, type: "day" },
      );
      // Fit the whole range, so a longer range actually shows more history.
      chart.setBarSpace(element.clientWidth / candles.length);
      chart.setDataLoader({
        getBars: ({ callback }) => callback(candles, false),
      });
      chart.createIndicator({ name: "MA", paneId: "candle_pane" }, true);
      chart.createIndicator("VOL");
      const observer = new ResizeObserver(() => chart.resize());
      observer.observe(element);
      cleanup = () => {
        observer.disconnect();
        dispose(element);
      };
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [symbol, candles, interval, theme]);

  return (
    <div
      ref={container}
      className="chart-canvas"
      role="img"
      aria-label={`${symbol} ${interval} candlestick chart, ${candles.length} bars`}
    />
  );
}
