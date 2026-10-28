"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiClient, createIdempotencyKey } from "@/lib/api-client";
import { quantity as fmtQty, percent, price, rupees, tone } from "@/lib/format";
import { num, str } from "@/lib/market";
import { type Side, useTrackedQuotes, useTrader } from "./trader-provider";

export function OrderWindow() {
  const { ticket } = useTrader();
  if (!ticket) return null;
  // Remount per instrument so quantity and request key never leak between scrips.
  return (
    <OrderForm
      key={ticket.instrument.instrumentKey}
      initialSide={ticket.side}
    />
  );
}

function OrderForm({ initialSide }: { initialSide: Side }) {
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
  const holding = positions.find((p) => p.instrumentId === key);
  const held = num(holding?.quantity) ?? 0;
  const longQty = Math.max(0, held);
  const shortQty = Math.max(0, -held);
  const freeLong = Math.min(longQty, num(holding?.availableQuantity) ?? 0);
  const avgCost = num(holding?.averageCost) ?? 0;
  const cash = num(account?.mockBuyingPower ?? account?.mockCashBalance);
  const ltp = view.price;
  const value = qtyValid && ltp !== null ? n * ltp : null;
  // Mirrors the API: a sale closes the long first and shorts the rest; a short
  // costs buying power equal to its value, and covering releases twice the
  // entry value held against it.
  const closing = side === "sell" ? Math.min(n || 0, longQty) : 0;
  const opening = side === "sell" ? Math.max(0, (n || 0) - longQty) : 0;
  const covering = side === "buy" ? Math.min(n || 0, shortQty) : 0;
  const shortMargin = ltp !== null ? opening * ltp : null;
  const required = side === "buy" ? value : shortMargin;
  const capacity =
    cash === null
      ? null
      : side === "buy"
        ? cash + 2 * covering * avgCost
        : cash + closing * (ltp ?? 0);

  let blocker = "";
  if (!account) blocker = "Sign in to an active practice account to trade.";
  else if (account.status !== "active")
    blocker = `Your account is ${account.status}. Trading is disabled.`;
  else if (!live)
    blocker =
      "Live quote unavailable. Market orders execute only against a fresh live quote.";
  else if (!qtyValid)
    blocker =
      lot > 1
        ? `Quantity must be a multiple of ${lot}.`
        : "Enter a valid quantity.";
  else if (side === "sell" && closing > freeLong)
    blocker = `${fmtQty(longQty - freeLong)} shares are reserved by open orders. Cancel them first.`;
  else if (required && capacity !== null && required > capacity)
    blocker =
      side === "buy"
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
            type: "market",
            timeInForce: "day",
            quantity: n,
          },
        },
      );
      if (response.data?.filled) {
        const fill =
          response.data.order.averageFillPrice ??
          str(response.data.trade.price);
        notify({
          tone: "success",
          title: `${side === "buy" ? "Bought" : "Sold"} ${fmtQty(n)} ${instrument.symbol}`,
          body: `Executed at ₹${price(fill)} · ${instrument.exchange}`,
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

  return (
    <div className="order-backdrop">
      <form
        className={`order-window ${side}`}
        onSubmit={(e) => void submit(e)}
        aria-label={`${side === "buy" ? "Buy" : "Sell"} ${instrument.symbol}`}
      >
        <header className="order-head">
          <div>
            <div className="order-title">
              {side === "buy" ? "Buy" : "Sell"} {instrument.symbol}{" "}
              <span className="order-exch">{instrument.exchange}</span>
              <span className="order-qty">
                × {qtyValid ? fmtQty(n) : 0} Qty
              </span>
            </div>
            <div className="order-ltp num">
              ₹{price(view.price)}{" "}
              <span className={tone(view.change)}>
                {percent(view.changePercent)}
              </span>
              {view.source !== "live" && (
                <span className="order-flag">
                  {view.source === "close"
                    ? "Last close"
                    : view.source === "stale"
                      ? "Stale"
                      : "No quote"}
                </span>
              )}
            </div>
          </div>
          <div className="order-head-right">
            <fieldset className="side-switch" aria-label="Side">
              {(["buy", "sell"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={side === s}
                  className={side === s ? `on ${s}` : ""}
                  onClick={() => {
                    setSide(s);
                    reset();
                  }}
                >
                  {s === "buy" ? "B" : "S"}
                </button>
              ))}
            </fieldset>
            <button
              type="button"
              className="icon-button light"
              onClick={closeTicket}
              aria-label="Close order window"
              disabled={submitting}
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="order-body">
          <div className="order-fields">
            <label className="field">
              <span>Qty.{lot > 1 && ` (lot ${lot})`}</span>
              <input
                ref={qtyInput}
                className="num"
                type="number"
                inputMode="numeric"
                min={lot}
                step={lot}
                value={qty}
                onChange={(e) => {
                  setQty(e.target.value);
                  reset();
                }}
                required
              />
            </label>
            <label className="field">
              <span>Price</span>
              <input value="Market" disabled readOnly />
            </label>
            <label className="field">
              <span>Validity</span>
              <input value="Day" disabled readOnly />
            </label>
          </div>
          <p className="order-note">
            Market order · executes at the latest live price. The fill may
            differ slightly from the estimate.
          </p>
          <div className="order-holding">
            Position{" "}
            <strong className="num">
              {held > 0
                ? `${fmtQty(held)} long`
                : held < 0
                  ? `${fmtQty(-held)} short`
                  : "none"}
            </strong>
            {opening > 0 && (
              <>
                {" "}
                · shorts <strong className="num">{fmtQty(opening)}</strong>
                {closing > 0 && <> after selling {fmtQty(closing)} held</>}
              </>
            )}
            {covering > 0 && (
              <>
                {" "}
                · covers <strong className="num">{fmtQty(covering)}</strong>{" "}
                short
              </>
            )}
          </div>
          {(error || blocker) && (
            <div
              className={`order-msg ${error ? "error" : ""}`}
              role={error ? "alert" : undefined}
            >
              {error || blocker}
            </div>
          )}
        </div>

        <footer className="order-foot">
          <div className="order-margins">
            <span>
              {side === "buy"
                ? "Required"
                : opening > 0
                  ? "Short margin"
                  : "Est. value"}{" "}
              <strong className="num">
                {rupees(side === "sell" && opening > 0 ? shortMargin : value)}
              </strong>
            </span>
            <span>
              Available <strong className="num">{rupees(cash)}</strong>
            </span>
          </div>
          <div className="order-actions">
            <button
              type="submit"
              className={`btn btn-${side}`}
              disabled={!!blocker || submitting}
            >
              {submitting ? "Placing…" : side === "buy" ? "Buy" : "Sell"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={closeTicket}
              disabled={submitting}
            >
              Cancel
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}
