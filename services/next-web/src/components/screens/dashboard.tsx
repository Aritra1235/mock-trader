"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  percent,
  price,
  quantity,
  rupees,
  signedPrice,
  stamp,
  tone,
} from "@/lib/format";
import { num } from "@/lib/market";
import { Empty, InstrumentCell, SideTag, StatusTag } from "../bits";
import { useTrader } from "../trader-provider";
import { useHoldings } from "./holdings";

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat("en-IN", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: "Asia/Kolkata",
    }).format(new Date()),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function DashboardScreen() {
  const { auth, userName, account, summary, orders, instruments } = useTrader();
  const { rows, invested, value, pnl, pnlPct, day } = useHoldings();
  const [hello, setHello] = useState("");
  useEffect(() => setHello(greeting()), []);

  const firstName = userName.split(" ")[0] || "trader";
  const starting = num(account?.startingBalance);
  const cash = num(account?.mockBuyingPower) ?? num(account?.mockCashBalance);
  const reserved = num(account?.reservedMockCash) ?? 0;
  const equity = summary.equity ?? (cash ?? 0) + reserved + value;
  const totalReturn = starting !== null ? equity - starting : null;
  const totalReturnPct =
    starting && totalReturn !== null ? (totalReturn / starting) * 100 : null;

  return (
    <div className="screen">
      <header className="dash-head">
        <div>
          <p className="eyebrow">{hello || " "}</p>
          <h1>{auth === "loading" ? " " : firstName}</h1>
        </div>
        {account && (
          <div className="dash-account">
            <span>Practice account</span>
            <strong className="num">{account.accountNumber}</strong>
          </div>
        )}
      </header>

      <div className="metrics">
        <Metric label="Account value" value={rupees(equity)}>
          <span className={tone(totalReturn)}>
            {signedPrice(totalReturn)} ({percent(totalReturnPct)})
          </span>{" "}
          all time
        </Metric>
        <Metric label="Available cash" value={rupees(cash)}>
          {rupees(reserved)} blocked for orders
        </Metric>
        <Metric
          label="Holdings P&L"
          value={signedPrice(rows.length ? pnl : null)}
          tone={tone(pnl)}
        >
          {rows.length ? (
            <>
              <span className={tone(pnl)}>{percent(pnlPct)}</span> on{" "}
              {rupees(invested)} invested
            </>
          ) : (
            "No open holdings"
          )}
        </Metric>
        <Metric label="Day's change" value={signedPrice(day)} tone={tone(day)}>
          Realised P&amp;L{" "}
          <span className={tone(summary.realizedPnl)}>
            {signedPrice(summary.realizedPnl)}
          </span>
        </Metric>
      </div>

      <div className="dash-cols">
        <section className="panel flush">
          <div className="panel-head padded">
            <h2>
              Holdings <span className="count">{rows.length}</span>
            </h2>
            <Link href="/portfolio" className="link small">
              View all
            </Link>
          </div>
          {rows.length === 0 ? (
            <Empty title="No holdings yet">
              Pick a stock from your watchlist and buy it to start a portfolio.
              <Link href="/markets" className="btn btn-primary">
                Explore markets
              </Link>
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="table table-hover">
                <thead>
                  <tr>
                    <th>Instrument</th>
                    <th className="r">Qty.</th>
                    <th className="r">LTP</th>
                    <th className="r">Cur. value</th>
                    <th className="r">P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 8).map((r) => (
                    <tr key={r.p.id}>
                      <td>
                        <InstrumentCell
                          instrumentKey={r.p.instrumentId}
                          instrument={instruments[r.p.instrumentId]}
                        />
                      </td>
                      <td className="r num">
                        {quantity(r.qty)}
                        {r.qty < 0 && <span className="short-mark">SHORT</span>}
                      </td>
                      <td className="r num">{price(r.ltp)}</td>
                      <td className="r num">{price(r.value)}</td>
                      <td className={`r num ${tone(r.pnl)}`}>
                        {signedPrice(r.pnl)}
                        <small className="cell-sub">{percent(r.net)}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel flush">
          <div className="panel-head padded">
            <h2>Recent orders</h2>
            <Link href="/activity" className="link small">
              View all
            </Link>
          </div>
          {orders.length === 0 ? (
            <Empty title="No orders yet">Orders you place show up here.</Empty>
          ) : (
            <ul className="order-feed">
              {orders.slice(0, 6).map((o) => (
                <li key={o.id}>
                  <SideTag side={o.side} />
                  <div className="order-feed-main">
                    <InstrumentCell
                      instrumentKey={o.instrumentId}
                      instrument={instruments[o.instrumentId]}
                    />
                    <span className="muted num">
                      {quantity(o.filledQuantity || o.quantity)} @{" "}
                      {price(o.averageFillPrice)}
                    </span>
                  </div>
                  <div className="order-feed-side">
                    <StatusTag status={o.status} />
                    <span className="muted num">
                      {stamp(o.placedAt ?? o.createdAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone: valueTone = "",
  children,
}: {
  label: string;
  value: string;
  tone?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="metric">
      <span className="metric-label">{label}</span>
      <strong className={`metric-value num ${valueTone}`}>{value}</strong>
      {children && <span className="metric-sub">{children}</span>}
    </div>
  );
}
