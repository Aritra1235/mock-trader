"use client";

import Link from "next/link";
import { price, quantity, rupees, stamp } from "@/lib/format";
import { num, str } from "@/lib/market";
import {
  Empty,
  InstrumentCell,
  ledgerLabel,
  PageHeader,
  SideTag,
  StatusTag,
} from "../bits";
import { useTrader } from "../trader-provider";

export type OrdersTab = "orders" | "trades" | "funds";
const tabs: { key: OrdersTab; label: string }[] = [
  { key: "orders", label: "Orders" },
  { key: "trades", label: "Trades" },
  { key: "funds", label: "Funds" },
];

export function OrdersScreen({ tab }: { tab: OrdersTab }) {
  const { orders, trades } = useTrader();
  const counts: Record<OrdersTab, number | null> = {
    orders: orders.length,
    trades: trades.length,
    funds: null,
  };
  return (
    <div className="screen">
      <PageHeader title={tab === "funds" ? "Funds" : "Orders"} />
      <nav className="tabs" aria-label="Order views">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.key === "orders" ? "/activity" : `/activity?tab=${t.key}`}
            className={tab === t.key ? "active" : ""}
            aria-current={tab === t.key ? "page" : undefined}
          >
            {t.label}
            {counts[t.key] ? (
              <span className="count">{counts[t.key]}</span>
            ) : null}
          </Link>
        ))}
      </nav>
      {tab === "orders" && <OrderBook />}
      {tab === "trades" && <TradeBook />}
      {tab === "funds" && <Funds />}
    </div>
  );
}

function OrderBook() {
  const { orders, instruments } = useTrader();
  if (orders.length === 0)
    return (
      <section className="panel">
        <Empty title="You haven't placed any orders">
          Orders you place from the watchlist or a chart appear here.
        </Empty>
      </section>
    );
  return (
    <section className="panel flush">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Type</th>
              <th>Instrument</th>
              <th>Product</th>
              <th className="r">Qty.</th>
              <th className="r">Avg. price</th>
              <th className="r">Status</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const reason = str((o as Record<string, unknown>).rejectedReason);
              return (
                <tr key={o.id}>
                  <td className="muted num">
                    {stamp(o.placedAt ?? o.createdAt)}
                  </td>
                  <td>
                    <SideTag side={o.side} />
                  </td>
                  <td>
                    <InstrumentCell
                      instrumentKey={o.instrumentId}
                      instrument={instruments[o.instrumentId]}
                    />
                  </td>
                  <td className="muted">MARKET · DAY</td>
                  <td className="r num">
                    {quantity(o.filledQuantity)} / {quantity(o.quantity)}
                  </td>
                  <td className="r num">{price(o.averageFillPrice)}</td>
                  <td className="r" title={reason || undefined}>
                    <StatusTag status={o.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TradeBook() {
  const { trades, instruments } = useTrader();
  if (trades.length === 0)
    return (
      <section className="panel">
        <Empty title="No trades yet">Executed fills appear here.</Empty>
      </section>
    );
  return (
    <section className="panel flush">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Trade ID</th>
              <th>Fill time</th>
              <th>Type</th>
              <th>Instrument</th>
              <th className="r">Qty.</th>
              <th className="r">Price</th>
              <th className="r">Value</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t, i) => {
              const key = str(t.instrumentId);
              const id = str(t.id);
              const gross =
                num(t.grossAmount) ??
                (num(t.price) ?? 0) * (num(t.quantity) ?? 0);
              return (
                <tr key={id || i}>
                  <td className="muted num" title={id}>
                    {id ? id.slice(0, 8).toUpperCase() : "—"}
                  </td>
                  <td className="muted num">{stamp(t.executedAt)}</td>
                  <td>
                    <SideTag side={str(t.side)} />
                  </td>
                  <td>
                    <InstrumentCell
                      instrumentKey={key}
                      instrument={instruments[key]}
                    />
                  </td>
                  <td className="r num">{quantity(t.quantity)}</td>
                  <td className="r num">{price(t.price)}</td>
                  <td className="r num">{price(gross)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Funds() {
  const { account, ledger } = useTrader();
  return (
    <>
      <div className="funds-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Equity</h2>
          </div>
          <dl className="kv">
            <div className="kv-strong">
              <dt>Available margin</dt>
              <dd className="num">{rupees(account?.mockBuyingPower)}</dd>
            </div>
            <div>
              <dt>Used margin</dt>
              <dd className="num">{rupees(account?.reservedMockCash)}</dd>
            </div>
            <div>
              <dt>Cash balance</dt>
              <dd className="num">{rupees(account?.mockCashBalance)}</dd>
            </div>
            <div>
              <dt>Opening balance</dt>
              <dd className="num">{rupees(account?.startingBalance)}</dd>
            </div>
          </dl>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Account</h2>
          </div>
          <dl className="kv">
            <div>
              <dt>Account number</dt>
              <dd className="num">{account?.accountNumber ?? "—"}</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>Practice</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd className="cap">{account?.status ?? "—"}</dd>
            </div>
            <div>
              <dt>Currency</dt>
              <dd>INR</dd>
            </div>
          </dl>
        </section>
      </div>
      <section className="panel flush">
        <div className="panel-head padded">
          <h2>Ledger</h2>
        </div>
        {ledger.length === 0 ? (
          <Empty title="No ledger entries" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Particulars</th>
                  <th className="r">Debit</th>
                  <th className="r">Credit</th>
                  <th className="r">Balance</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((entry) => {
                  const amount = num(entry.amount) ?? 0;
                  return (
                    <tr key={entry.id}>
                      <td className="muted num">{stamp(entry.occurredAt)}</td>
                      <td>{ledgerLabel(entry.type, entry.description)}</td>
                      <td className="r num down">
                        {amount < 0 ? price(-amount) : ""}
                      </td>
                      <td className="r num up">
                        {amount > 0 ? price(amount) : ""}
                      </td>
                      <td className="r num">{price(entry.balanceAfter)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
