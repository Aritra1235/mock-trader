"use client";

import { useEffect, useState } from "react";
import { clock, percent, price, signedPrice, tone } from "@/lib/format";
import { marketSession } from "@/lib/market";
import { useTrackedQuotes, useTrader } from "./trader-provider";

// Security IDs from the provider's security master, subscribed as indices.
const indices = [
  { label: "NIFTY 50", key: "NSE:INDEX:13" },
  { label: "SENSEX", key: "BSE:INDEX:51" },
];
const QUOTE_AGE_MS = 45_000;

export function IndexBar() {
  const { auth, priceOf, quoteOf } = useTrader();
  const [now, setNow] = useState(() => Date.now());
  useTrackedQuotes(indices.map((index) => index.key));

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <section className="index-bar" aria-label="Market indices">
      {indices.map((index) => {
        const view = priceOf(index.key);
        const quote = quoteOf(index.key)?.quote;
        const receivedAt = Date.parse(quote?.receivedAt ?? "");
        const delayed =
          auth !== "ready" ||
          view.source === "stale" ||
          view.source === "close" ||
          !Number.isFinite(receivedAt) ||
          now - receivedAt > QUOTE_AGE_MS;
        const status =
          view.price === null
            ? auth === "ready"
              ? "Waiting for quotes"
              : "Unavailable"
            : marketSession(new Date(now)) === "closed"
              ? "Closed"
              : delayed
                ? "Delayed"
                : "";
        return (
          <div
            className="index-quote"
            key={index.key}
            title={
              quote
                ? `Last quote ${clock(quote.receivedAt)} · ${status || "Updating"}`
                : status
            }
          >
            <span className="index-name">{index.label}</span>
            <span className="index-price num">{price(view.price)}</span>
            <span className={`index-change num ${tone(view.change)}`}>
              {signedPrice(view.change)} ({percent(view.changePercent)})
            </span>
            {status && <span className="index-status">{status}</span>}
          </div>
        );
      })}
    </section>
  );
}
