"use client";

import Link from "next/link";
import {
  percent,
  price,
  quantity,
  rupees,
  signedPrice,
  tone,
} from "@/lib/format";
import { num } from "@/lib/market";
import { Empty, InstrumentCell, PageHeader } from "../bits";
import { useTrader } from "../trader-provider";

/** Values every holding at the latest available price so all screens agree. */
export function useHoldings() {
  const { positions, priceOf } = useTrader();
  const rows = positions.map((p) => {
    const qty = num(p.quantity) ?? 0;
    const avg = num(p.averageCost) ?? 0;
    const view = priceOf(p.instrumentId);
    const ltp = view.price ?? num(p.currentPrice);
    // Shorts carry a negative quantity: P&L is (ltp − entry) × qty, and the
    // capital at work is the entry value, so value = invested + P&L.
    const invested = Math.abs(qty) * avg;
    const pnl = ltp !== null ? (ltp - avg) * qty : (num(p.unrealizedPnl) ?? 0);
    const value = invested + pnl;
    return {
      p,
      qty,
      avg,
      ltp,
      invested,
      value,
      pnl,
      net: invested > 0 ? (pnl / invested) * 100 : null,
      dayPct: view.changePercent,
      day: view.change !== null ? view.change * qty : null,
      stale: view.source !== "live",
    };
  });
  const invested = rows.reduce((t, r) => t + r.invested, 0);
  const value = rows.reduce((t, r) => t + r.value, 0);
  const pnl = value - invested;
  const dayRows = rows.filter((r) => r.day !== null);
  return {
    rows,
    day: dayRows.length ? dayRows.reduce((t, r) => t + (r.day ?? 0), 0) : null,
    invested,
    value,
    pnl,
    pnlPct: invested > 0 ? (pnl / invested) * 100 : null,
  };
}

export function HoldingsScreen() {
  const { positions, instruments, summary, openTicket } = useTrader();
  const { rows, invested, value, pnl } = useHoldings();

  return (
    <div className="screen">
      <PageHeader
        title={`Holdings (${positions.length})`}
        meta="Open long and short positions in your practice account"
      />
      {positions.length === 0 ? (
        <section className="panel">
          <Empty title="You don't have any holdings yet">
            <Link href="/markets" className="btn btn-primary">
              Explore stocks
            </Link>
          </Empty>
        </section>
      ) : (
        <>
          <div className="stat-strip">
            <div>
              <span>Total investment</span>
              <strong className="num">{rupees(invested)}</strong>
            </div>
            <div>
              <span>Current value</span>
              <strong className="num">{rupees(value)}</strong>
            </div>
            <div>
              <span>Total P&amp;L</span>
              <strong className={`num ${tone(pnl)}`}>
                {signedPrice(pnl)}{" "}
                <small>
                  {percent(invested > 0 ? (pnl / invested) * 100 : null)}
                </small>
              </strong>
            </div>
            <div>
              <span>Realised P&amp;L</span>
              <strong className={`num ${tone(summary.realizedPnl)}`}>
                {signedPrice(summary.realizedPnl)}
              </strong>
            </div>
          </div>
          <section className="panel flush">
            <div className="table-wrap">
              <table className="table table-hover">
                <thead>
                  <tr>
                    <th>Instrument</th>
                    <th className="r">Qty.</th>
                    <th className="r">Avg. cost</th>
                    <th className="r">LTP</th>
                    <th className="r">Invested</th>
                    <th className="r">Cur. val</th>
                    <th className="r">P&amp;L</th>
                    <th className="r">Net chg.</th>
                    <th className="r">Day chg.</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const instrument = instruments[r.p.instrumentId];
                    return (
                      <tr key={r.p.id}>
                        <td>
                          <div className="cell-with-actions">
                            <InstrumentCell
                              instrumentKey={r.p.instrumentId}
                              instrument={instrument}
                            />
                            {instrument && (
                              <span className="row-actions">
                                <button
                                  type="button"
                                  className="act act-buy"
                                  onClick={() => openTicket(instrument, "buy")}
                                  title="Add"
                                >
                                  B
                                </button>
                                <button
                                  type="button"
                                  className="act act-sell"
                                  onClick={() => openTicket(instrument, "sell")}
                                  title="Exit"
                                >
                                  S
                                </button>
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="r num">
                          {quantity(r.qty)}
                          {r.qty < 0 && (
                            <span className="short-mark">SHORT</span>
                          )}
                        </td>
                        <td className="r num">{price(r.avg)}</td>
                        <td className="r num">
                          {price(r.ltp)}
                          {r.stale && (
                            <span
                              className="stale-mark"
                              title="Not a live price"
                            >
                              *
                            </span>
                          )}
                        </td>
                        <td className="r num">{price(r.invested)}</td>
                        <td className="r num">{price(r.value)}</td>
                        <td className={`r num ${tone(r.pnl)}`}>
                          {signedPrice(r.pnl)}
                        </td>
                        <td className={`r num ${tone(r.net)}`}>
                          {percent(r.net)}
                        </td>
                        <td className={`r num ${tone(r.dayPct)}`}>
                          {percent(r.dayPct)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td />
                    <td />
                    <td />
                    <td className="r num">{price(invested)}</td>
                    <td className="r num">{price(value)}</td>
                    <td className={`r num ${tone(pnl)}`}>{signedPrice(pnl)}</td>
                    <td className={`r num ${tone(pnl)}`}>
                      {percent(invested > 0 ? (pnl / invested) * 100 : null)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
          {rows.some((r) => r.stale) && (
            <p className="footnote">
              * Live quote unavailable; valued at the last close or the reported
              position price.
            </p>
          )}
        </>
      )}
    </div>
  );
}
