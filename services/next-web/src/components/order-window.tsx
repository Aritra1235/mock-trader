"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiClient, createIdempotencyKey } from "@/lib/api-client";
import { quantity as fmtQty, percent, price, rupees, tone } from "@/lib/format";
import {
  INTRADAY_LEVERAGE,
  INTRADAY_MARGIN_RATE,
  intradayWindow,
  marketSession,
  num,
  type Product,
  positionHold,
  str,
} from "@/lib/market";
import { type Side, useTrackedQuotes, useTrader } from "./trader-provider";

export function OrderWindow() {
  const { ticket } = useTrader();
  if (!ticket) return null;
  // Remount per instrument so quantity and request key never leak between scrips.
  return (
    <OrderForm
      key={`${ticket.instrument.instrumentKey}:${ticket.product ?? ""}`}
      initialSide={ticket.side}
      initialProduct={ticket.product ?? "delivery"}
    />
  );
}

function OrderForm({
  initialSide,
  initialProduct,
}: {
  initialSide: Side;
  initialProduct: Product;
}) {
  const {
    ticket,
    closeTicket,
    account,
    positions,
    priceOf,
    quoteOf,
    refresh,
    notify,
  } = useTrader();
  const instrument = ticket?.instrument;
  useTrackedQuotes(instrument ? [instrument.instrumentKey] : []);
  const [side, setSide] = useState<Side>(initialSide);
  const [qty, setQty] = useState(String(instrument?.lotSize || 1));
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [validity, setValidity] = useState<"day" | "gtc" | "ioc">("day");
  const [product, setProduct] = useState<Product>(initialProduct);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const requestKey = useRef<string | null>(null);
  const qtyInput = useRef<HTMLInputElement>(null);

  useEffect(() => setSide(initialSide), [initialSide]);
  useEffect(() => {
    qtyInput.current?.select();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) closeTicket();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeTicket, submitting]);

  if (!instrument) return null;
  const key = instrument.instrumentKey;
  const view = priceOf(key);
  const entry = quoteOf(key);
  const live = view.source === "live" && entry?.quote?.tradable !== false;
  const lot =
    instrument.lotSize && instrument.lotSize > 0 ? instrument.lotSize : 1;
  const n = Number(qty);
  const qtyValid = Number.isInteger(n) && n > 0 && n % lot === 0;
  // Delivery and intraday are separate positions in the same stock.
  const holding = positions.find(
    (p) => p.instrumentId === key && (p.product ?? "delivery") === product,
  );
  const held = num(holding?.quantity) ?? 0;
  const longQty = Math.max(0, held);
  const shortQty = Math.max(0, -held);
  const freeLong = Math.min(
    longQty,
    Math.max(0, num(holding?.availableQuantity) ?? 0),
  );
  const avgCost = num(holding?.averageCost) ?? 0;
  const cash = num(account?.mockBuyingPower ?? account?.mockCashBalance);
  const ltp = view.price;
  const tick =
    instrument.tickSize && instrument.tickSize > 0 ? instrument.tickSize : 0.01;
  const limit = Number(limitPrice);
  const limitValid =
    limitPrice.trim() !== "" &&
    Number.isFinite(limit) &&
    limit > 0 &&
    Math.abs(limit / tick - Math.round(limit / tick)) < 1e-6;
  const fillsNow =
    orderType === "market" ||
    (live &&
      marketSession() === "open" &&
      ltp !== null &&
      limitValid &&
      (side === "buy" ? ltp <= limit : ltp >= limit));
  const estimatePrice =
    orderType === "limit" && !fillsNow ? (limitValid ? limit : null) : ltp;
  const value = qtyValid && estimatePrice !== null ? n * estimatePrice : null;
  const rate = product === "intraday" ? INTRADAY_MARGIN_RATE : 1;
  // Mirrors the API: an order closes the existing position first and opens
  // the rest. Only the opening part needs margin.
  const qtyN = qtyValid ? n : 0;
  const closing = side === "sell" ? Math.min(qtyN, longQty) : 0;
  const covering = side === "buy" ? Math.min(qtyN, shortQty) : 0;
  const opening = qtyN - (side === "sell" ? closing : covering);
  const marginPrice =
    orderType === "limit" && !fillsNow && estimatePrice !== null
      ? side === "sell"
        ? Math.max(estimatePrice, ltp ?? 0)
        : estimatePrice
      : estimatePrice;
  const margin = marginPrice !== null ? opening * marginPrice * rate : null;
  // Fills now: buying power after the trade must stay >= 0 (exits always pass).
  // Rests: the API reserves the margin on the whole buy, or on a sell's opening part.
  let shortfall = false;
  if (cash !== null && marginPrice !== null) {
    if (fillsNow) {
      const p = marginPrice;
      const next = held + (side === "buy" ? qtyN : -qtyN);
      const nextAvg =
        next === 0
          ? 0
          : side === "buy"
            ? next < 0
              ? avgCost
              : held <= 0
                ? p
                : (held * avgCost + qtyN * p) / next
            : next > 0
              ? avgCost
              : (shortQty * avgCost + opening * p) / (shortQty + opening);
      const after =
        cash +
        (side === "buy" ? -qtyN * p : qtyN * p) -
        (positionHold(product, next, nextAvg) -
          positionHold(product, held, avgCost));
      shortfall = opening > 0 && after < 0;
    } else {
      const reserved = (side === "buy" ? qtyN : opening) * marginPrice * rate;
      shortfall = reserved > cash;
    }
  }
  const session = intradayWindow();

  let blocker = "";
  if (!account) blocker = "Sign in to an active practice account to trade.";
  else if (account.status !== "active")
    blocker = `Your account is ${account.status}. Trading is disabled.`;
  else if (product === "intraday" && session === "closed")
    blocker =
      "Intraday trading runs 9:15 am – 3:20 pm IST on weekdays. Use Delivery outside those hours.";
  else if (orderType === "market" && !live)
    blocker =
      "Live quote unavailable. Market orders execute only against a fresh live quote.";
  else if (!qtyValid)
    blocker =
      lot > 1
        ? `Quantity must be a multiple of ${lot}.`
        : "Enter a valid quantity.";
  else if (orderType === "limit" && !limitValid)
    blocker = `Enter a positive limit price in steps of ₹${price(tick)}.`;
  else if (product === "delivery" && side === "sell" && opening > 0)
    blocker =
      longQty > 0
        ? `You hold ${fmtQty(longQty)} on delivery. Short selling is intraday only.`
        : "Short selling is intraday only. Switch to Intraday to short.";
  else if (product === "intraday" && opening > 0 && session === "exit_only")
    blocker =
      "New intraday positions close at 3:15 pm IST. You can still exit open ones.";
  else if (side === "sell" && closing > freeLong)
    blocker = `${fmtQty(longQty - freeLong)} shares are reserved by open orders. Cancel them first.`;
  else if (shortfall)
    blocker =
      product === "intraday"
        ? "Not enough buying power for the intraday margin."
        : side === "buy"
          ? "Insufficient funds for this order."
          : "Not enough buying power for the short-sale margin.";

  const reset = () => {
    requestKey.current = null;
    setError("");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!account || blocker || submitting) return;
    // Reuse the key while retrying the same order so the API can deduplicate it.
    requestKey.current ??= createIdempotencyKey();
    setSubmitting(true);
    setError("");
    try {
      const response = await apiClient.POST(
        "/api/v1/accounts/{accountId}/orders",
        {
          params: {
            path: { accountId: account.id },
            header: { "Idempotency-Key": requestKey.current },
          },
          body: {
            instrumentId: key,
            side,
            type: orderType,
            timeInForce: validity,
            product,
            ...(orderType === "limit" ? { limitPrice: limit } : {}),
            quantity: n,
          },
        },
      );
      if (response.data?.filled) {
        const fill =
          response.data.order.averageFillPrice ??
          str(response.data.trade?.price);
        notify({
          tone: "success",
          title: `${side === "buy" ? "Bought" : "Sold"} ${fmtQty(n)} ${instrument.symbol}`,
          body: `Executed at ₹${price(fill)} · ${instrument.exchange} · ${product === "intraday" ? "Intraday" : "Delivery"}`,
        });
        requestKey.current = null;
        closeTicket();
        void refresh();
      } else if (response.data) {
        const order = response.data.order;
        const terminal = ["canceled", "expired", "rejected"].includes(
          order.status ?? "",
        );
        notify({
          tone: order.status === "rejected" ? "error" : "info",
          title: terminal ? `Order ${order.status}` : "Limit order placed",
          body: terminal
            ? order.rejectedReason ||
              order.canceledReason ||
              "Reserved funds and shares have been released."
            : `${instrument.symbol} · ₹${price(limit)} · ${validity.toUpperCase()}. Track or cancel it in Orders.`,
        });
        requestKey.current = null;
        closeTicket();
        void refresh();
      } else {
        setError(
          response.error?.error?.message ??
            "The order was rejected. Try again.",
        );
        // A definitive rejection needs a fresh key; a server error can be retried as-is.
        if (response.response.status < 500) requestKey.current = null;
      }
    } catch {
      setError(
        "Connection lost. Retry — the same order reference prevents a duplicate fill.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const sideLabel = side === "buy" ? "Buy" : "Sell";
  const productLabel = product === "intraday" ? "intraday" : "delivery";
  const position =
    held > 0
      ? `${fmtQty(held)} long · ${productLabel}`
      : held < 0
        ? `${fmtQty(-held)} short · ${productLabel}`
        : "";
  const effect =
    side === "sell" && opening > 0
      ? closing > 0
        ? `Sells ${fmtQty(closing)} held, then shorts ${fmtQty(opening)}`
        : `Opens a short of ${fmtQty(opening)}`
      : covering > 0
        ? `Covers ${fmtQty(covering)} short`
        : "";

  return (
    <form
      className={`ticket ${side}`}
      onSubmit={(e) => void submit(e)}
      aria-label={`${sideLabel} ${instrument.symbol}`}
    >
      <header className="ticket-head">
        <div className="ticket-title">
          <div className="ticket-id">
            <strong>{instrument.symbol}</strong>
            <small>{instrument.exchange}</small>
          </div>
          <div className="ticket-ltp num">
            ₹{price(view.price)}{" "}
            <span className={tone(view.change)}>
              {percent(view.changePercent)}
            </span>
            {view.source !== "live" && (
              <span className="ticket-flag">
                {view.source === "close"
                  ? "Last close"
                  : view.source === "stale"
                    ? "Stale"
                    : "No quote"}
              </span>
            )}
          </div>
        </div>
        <fieldset
          className="ticket-seg ticket-side"
          aria-label="Side"
          disabled={submitting}
        >
          {(["buy", "sell"] as const).map((s) => (
            <label key={s} className={s}>
              <input
                type="radio"
                name="side"
                value={s}
                checked={side === s}
                onChange={() => {
                  setSide(s);
                  reset();
                }}
              />
              {s === "buy" ? "Buy" : "Sell"}
            </label>
          ))}
        </fieldset>
        <button
          type="button"
          className="ticket-close"
          onClick={closeTicket}
          aria-label="Close order window"
          disabled={submitting}
        >
          <X size={16} />
        </button>
      </header>

      <div className="ticket-body">
        <div className="ticket-opts">
          <fieldset
            className="ticket-seg"
            aria-label="Product"
            disabled={submitting}
          >
            {(
              [
                ["delivery", "Delivery", "CNC · held overnight, full cash"],
                [
                  "intraday",
                  "Intraday",
                  `MIS · ${INTRADAY_LEVERAGE}x margin, squared off at 3:20 pm IST`,
                ],
              ] as const
            ).map(([value, label, hint]) => (
              <label key={value} title={hint}>
                <input
                  type="radio"
                  name="product"
                  value={value}
                  checked={product === value}
                  onChange={() => {
                    setProduct(value);
                    if (value === "intraday" && validity === "gtc")
                      setValidity("day");
                    reset();
                  }}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <fieldset
            className="ticket-seg"
            aria-label="Order type"
            disabled={submitting}
          >
            {(["market", "limit"] as const).map((type) => (
              <label key={type}>
                <input
                  type="radio"
                  name="orderType"
                  value={type}
                  checked={orderType === type}
                  onChange={() => {
                    setOrderType(type);
                    if (type === "limit" && !limitPrice && ltp !== null) {
                      setLimitPrice(
                        String(
                          Number((Math.round(ltp / tick) * tick).toFixed(8)),
                        ),
                      );
                    }
                    reset();
                  }}
                />
                {type === "market" ? "Market" : "Limit"}
              </label>
            ))}
          </fieldset>
          {orderType === "limit" && (
            <fieldset
              className="ticket-seg"
              aria-label="Validity"
              disabled={submitting}
            >
              {(
                [
                  [
                    "day",
                    "Day",
                    product === "intraday"
                      ? "Expires at the 3:20 pm IST square-off"
                      : "Expires at 3:30 pm IST",
                  ],
                  ["ioc", "IOC", "Fills immediately or is canceled"],
                  ["gtc", "GTC", "Stays open until filled or canceled"],
                ] as const
              )
                .filter(([value]) => product !== "intraday" || value !== "gtc")
                .map(([value, label, hint]) => (
                  <label key={value} title={hint}>
                    <input
                      type="radio"
                      name="validity"
                      value={value}
                      checked={validity === value}
                      onChange={() => {
                        setValidity(value);
                        reset();
                      }}
                    />
                    {label}
                  </label>
                ))}
            </fieldset>
          )}
        </div>

        <div className="ticket-fields">
          <label>
            <span>Qty{lot > 1 && ` · lot ${lot}`}</span>
            <input
              ref={qtyInput}
              className="num"
              type="number"
              inputMode="numeric"
              min={lot}
              step={lot}
              value={qty}
              disabled={submitting}
              onChange={(e) => {
                setQty(e.target.value);
                reset();
              }}
              required
            />
          </label>
          <label htmlFor="ticket-price">
            <span>Price</span>
            {orderType === "market" ? (
              <input id="ticket-price" value="Market" disabled readOnly />
            ) : (
              <input
                id="ticket-price"
                className="num"
                type="number"
                inputMode="decimal"
                min={tick}
                step={tick}
                value={limitPrice}
                disabled={submitting}
                required
                onChange={(e) => {
                  setLimitPrice(e.target.value);
                  reset();
                }}
              />
            )}
          </label>
        </div>

        {(orderType === "limit" && limitValid) ||
        position ||
        effect ||
        product === "intraday" ? (
          <ul className="ticket-notes">
            {product === "intraday" && (
              <li>
                {INTRADAY_LEVERAGE}x leverage · auto square-off at 3:20 pm IST
              </li>
            )}
            {orderType === "limit" && limitValid && (
              <li>
                Fills at ₹{price(limit)} or{" "}
                {side === "buy" ? "lower" : "higher"}
              </li>
            )}
            {position && (
              <li>
                Position <span className="num">{position}</span>
              </li>
            )}
            {effect && <li>{effect}</li>}
          </ul>
        ) : null}
        {(error || blocker) && (
          <p
            className={`ticket-msg ${error ? "error" : ""}`}
            role={error ? "alert" : undefined}
          >
            {error || blocker}
          </p>
        )}
      </div>

      <footer className="ticket-foot">
        <dl>
          <div>
            <dt>
              {opening > 0 && (product === "intraday" || side === "sell")
                ? "Margin"
                : side === "buy"
                  ? "Required"
                  : "Value"}
            </dt>
            <dd className="num">{rupees(opening > 0 ? margin : value)}</dd>
          </div>
          <div>
            <dt>Available</dt>
            <dd className="num">{rupees(cash)}</dd>
          </div>
        </dl>
        <button
          type="submit"
          className={`btn btn-${side}`}
          disabled={!!blocker || submitting}
        >
          {submitting
            ? "Placing…"
            : `${sideLabel} ${qtyValid ? fmtQty(n) : ""} ${instrument.symbol}`}
        </button>
      </footer>
    </form>
  );
}
