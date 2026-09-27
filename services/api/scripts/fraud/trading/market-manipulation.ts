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

const detector = "market-manipulation-risk";
const detectorVersion = "2026-07-10.1";
const options = readDetectorOptions(24);

type ManipulationRow = {
  accountId: string;
  userId: string;
  instrumentId: string;
  sampleOrderId: string;
  orderCount: number;
  canceledCount: number;
  rejectedCount: number;
  rapidCancelCount: number;
  unfilledNotional: string;
  filledNotional: string;
  maxOrderRiskScore: string;
  score: number;
};

const result = await db.execute(sql<ManipulationRow>`
  with recent_orders as (
    select *
    from orders
    where created_at >= ${options.since}
  ),
  grouped as (
    select
      account_id,
      user_id,
      instrument_id,
      max(id) as sample_order_id,
      count(*)::int as order_count,
      count(*) filter (where status = 'canceled')::int as canceled_count,
      count(*) filter (where status = 'rejected')::int as rejected_count,
      count(*) filter (
        where status = 'canceled'
          and updated_at <= created_at + interval '2 minutes'
      )::int as rapid_cancel_count,
      coalesce(sum(coalesce(notional_estimate, 0::numeric)) filter (
        where status in ('canceled', 'rejected', 'expired')
      ), 0)::text as unfilled_notional,
      coalesce(sum(coalesce(average_fill_price, 0::numeric) * filled_quantity::numeric) filter (
        where status in ('partially_filled', 'filled')
      ), 0)::text as filled_notional,
      coalesce(max(risk_score), 0)::text as max_order_risk_score
    from recent_orders
    group by account_id, user_id, instrument_id
  )
  select
    account_id as "accountId",
    user_id as "userId",
    instrument_id as "instrumentId",
    sample_order_id as "sampleOrderId",
    order_count as "orderCount",
    canceled_count as "canceledCount",
    rejected_count as "rejectedCount",
    rapid_cancel_count as "rapidCancelCount",
    unfilled_notional as "unfilledNotional",
    filled_notional as "filledNotional",
    max_order_risk_score as "maxOrderRiskScore",
    (
      case when order_count >= 60 then 30 when order_count >= 25 then 18 else 0 end +
      case when order_count > 0 and canceled_count::numeric / order_count >= 0.8 then 35 else 0 end +
      case when order_count > 0 and rejected_count::numeric / order_count >= 0.5 then 20 else 0 end +
      least(rapid_cancel_count * 10, 40) +
      case
        when unfilled_notional::numeric >= 100000
          and (filled_notional::numeric = 0 or unfilled_notional::numeric >= filled_notional::numeric * 5)
        then 30
        else 0
      end +
      least(max_order_risk_score::numeric, 40)
    )::int as score
  from grouped
  order by score desc, order_count desc
  limit ${options.limit}
`);

const findings: DetectorFinding[] = rowsOf<ManipulationRow>(result)
  .filter((row) => toNumber(row.score) >= options.minScore)
  .map((row) => ({
    type: "market_manipulation",
    severity: severityForScore(toNumber(row.score)),
    score: toNumber(row.score),
    title: "Market manipulation risk threshold exceeded",
    description:
      "Order pattern indicates possible spoofing, layering, excessive rapid cancellation, or abusive order placement.",
    detector,
    detectorVersion,
    userId: row.userId,
    accountId: row.accountId,
    orderId: row.sampleOrderId,
    evidence: {
      instrumentId: row.instrumentId,
      orderCount: row.orderCount,
      canceledCount: row.canceledCount,
      rejectedCount: row.rejectedCount,
      rapidCancelCount: row.rapidCancelCount,
      unfilledNotional: row.unfilledNotional,
      filledNotional: row.filledNotional,
      maxOrderRiskScore: row.maxOrderRiskScore,
    },
  }));

await closeFraudScript(detector, options, findings);
