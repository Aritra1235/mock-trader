import { sql } from "drizzle-orm";
import { db } from "../../../src/db";
import {
  closeFraudScript,
  type DetectorFinding,
  readDetectorOptions,
  rowsOf,
  severityForScore,
  toNumber,
} from "../shared/support";

const detector = "trade-abuse-risk";
const detectorVersion = "2026-07-10.1";
const options = readDetectorOptions(24);

type TradeAbuseRow = {
  tradeId: string;
  accountId: string;
  userId: string;
  instrumentId: string;
  side: string;
  quantity: string;
  price: string;
  grossAmount: string;
  counterpartyAccountId: string | null;
  counterpartyUserId: string | null;
  tradeCount: number;
  buyQuantity: string;
  sellQuantity: string;
  oppositeSideNearCount: number;
  sameUserCounterparty: boolean;
  score: number;
};

const result = await db.execute(sql<TradeAbuseRow>`
  with recent_trades as (
    select *
    from trades
    where executed_at >= ${options.since}
  ),
  account_instrument_activity as (
    select
      account_id,
      instrument_id,
      count(*)::int as trade_count,
      coalesce(sum(quantity::numeric) filter (where side = 'buy'), 0)::text as buy_quantity,
      coalesce(sum(quantity::numeric) filter (where side = 'sell'), 0)::text as sell_quantity
    from recent_trades
    group by account_id, instrument_id
  ),
  near_opposite as (
    select
      t.id as trade_id,
      count(o.id)::int as opposite_side_near_count
    from recent_trades t
    left join recent_trades o
      on o.account_id = t.account_id
      and o.instrument_id = t.instrument_id
      and o.side <> t.side
      and o.id <> t.id
      and o.executed_at between t.executed_at - interval '15 minutes'
        and t.executed_at + interval '15 minutes'
    group by t.id
  )
  select
    t.id as "tradeId",
    t.account_id as "accountId",
    t.user_id as "userId",
    t.instrument_id as "instrumentId",
    t.side,
    t.quantity,
    t.price,
    t.gross_amount as "grossAmount",
    t.counterparty_account_id as "counterpartyAccountId",
    cpa.user_id as "counterpartyUserId",
    aia.trade_count as "tradeCount",
    aia.buy_quantity as "buyQuantity",
    aia.sell_quantity as "sellQuantity",
    coalesce(no.opposite_side_near_count, 0)::int as "oppositeSideNearCount",
    (cpa.user_id is not null and cpa.user_id = t.user_id) as "sameUserCounterparty",
    (
      case when t.counterparty_account_id = t.account_id then 70 else 0 end +
      case when cpa.user_id is not null and cpa.user_id = t.user_id then 55 else 0 end +
      case
        when aia.buy_quantity::numeric > 0
          and aia.sell_quantity::numeric > 0
          and least(aia.buy_quantity::numeric, aia.sell_quantity::numeric)
            >= greatest(aia.buy_quantity::numeric, aia.sell_quantity::numeric) * 0.85
        then 35
        else 0
      end +
      case when aia.trade_count >= 20 then 25 when aia.trade_count >= 10 then 15 else 0 end +
      least(coalesce(no.opposite_side_near_count, 0) * 12, 36)
    )::int as score
  from recent_trades t
  join account_instrument_activity aia
    on aia.account_id = t.account_id
    and aia.instrument_id = t.instrument_id
  left join near_opposite no on no.trade_id = t.id
  left join trading_accounts cpa on cpa.id = t.counterparty_account_id
  order by score desc, t.executed_at desc
  limit ${options.limit}
`);

const findings: DetectorFinding[] = rowsOf<TradeAbuseRow>(result)
  .filter((row) => toNumber(row.score) >= options.minScore)
  .map((row) => ({
    type: "trade_abuse",
    severity: severityForScore(toNumber(row.score)),
    score: toNumber(row.score),
    title: "Trade abuse risk threshold exceeded",
    description:
      "Execution pattern indicates possible self-trading, wash trading, or rapid round-trip behavior.",
    detector,
    detectorVersion,
    userId: row.userId,
    accountId: row.accountId,
    tradeId: row.tradeId,
    evidence: {
      instrumentId: row.instrumentId,
      side: row.side,
      quantity: row.quantity,
      price: row.price,
      grossAmount: row.grossAmount,
      counterpartyAccountId: row.counterpartyAccountId,
      counterpartyUserMatched: row.sameUserCounterparty,
      counterpartyUserPresent: Boolean(row.counterpartyUserId),
      tradeCount: row.tradeCount,
      buyQuantity: row.buyQuantity,
      sellQuantity: row.sellQuantity,
      oppositeSideNearCount: row.oppositeSideNearCount,
    },
  }));

await closeFraudScript(detector, options, findings);
