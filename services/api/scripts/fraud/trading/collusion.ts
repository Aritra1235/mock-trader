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

const detector = "trade-collusion-risk";
const detectorVersion = "2026-07-10.1";
const options = readDetectorOptions(72);

type CollusionRow = {
  accountId: string;
  userId: string;
  relatedAccountId: string;
  relatedUserId: string;
  tradeCount: number;
  instrumentCount: number;
  grossAmount: string;
  sameDeviceMatched: boolean;
  oppositeDirectionCount: number;
  score: number;
};

const result = await db.execute(sql<CollusionRow>`
  with recent_counterparty_trades as (
    select
      t.*,
      ta.user_id as account_user_id,
      cpa.user_id as related_user_id,
      least(t.account_id, t.counterparty_account_id) as pair_account_a,
      greatest(t.account_id, t.counterparty_account_id) as pair_account_b
    from trades t
    join trading_accounts ta on ta.id = t.account_id
    join trading_accounts cpa on cpa.id = t.counterparty_account_id
    where t.executed_at >= ${options.since}
      and t.counterparty_account_id is not null
      and t.account_id <> t.counterparty_account_id
  ),
  pair_activity as (
    select
      pair_account_a,
      pair_account_b,
      min(account_user_id) as user_a,
      max(related_user_id) as user_b,
      count(*)::int as trade_count,
      count(distinct instrument_id)::int as instrument_count,
      coalesce(sum(gross_amount::numeric), 0)::text as gross_amount
    from recent_counterparty_trades
    group by pair_account_a, pair_account_b
  ),
  opposite_direction as (
    select
      a.pair_account_a,
      a.pair_account_b,
      count(*)::int as opposite_direction_count
    from recent_counterparty_trades a
    join recent_counterparty_trades b
      on b.pair_account_a = a.pair_account_a
      and b.pair_account_b = a.pair_account_b
      and b.instrument_id = a.instrument_id
      and b.side <> a.side
      and b.id <> a.id
      and b.executed_at between a.executed_at - interval '30 minutes'
        and a.executed_at + interval '30 minutes'
    group by a.pair_account_a, a.pair_account_b
  ),
  shared_device_pairs as (
    select distinct
      left_device.user_id as user_a,
      right_device.user_id as user_b
    from trusted_devices left_device
    join trusted_devices right_device
      on right_device.fingerprint_hash = left_device.fingerprint_hash
      and right_device.user_id <> left_device.user_id
    where left_device.revoked_at is null
      and right_device.revoked_at is null
  )
  select
    pa.pair_account_a as "accountId",
    ta.user_id as "userId",
    pa.pair_account_b as "relatedAccountId",
    rb.user_id as "relatedUserId",
    pa.trade_count as "tradeCount",
    pa.instrument_count as "instrumentCount",
    pa.gross_amount as "grossAmount",
    (sdp.user_a is not null) as "sameDeviceMatched",
    coalesce(od.opposite_direction_count, 0)::int as "oppositeDirectionCount",
    (
      case when pa.trade_count >= 20 then 35 when pa.trade_count >= 8 then 20 else 0 end +
      case when pa.instrument_count <= 2 and pa.trade_count >= 8 then 20 else 0 end +
      case when coalesce(od.opposite_direction_count, 0) >= 10 then 35
           when coalesce(od.opposite_direction_count, 0) >= 4 then 20
           else 0
      end +
      case when sdp.user_a is not null then 35 else 0 end +
      case when pa.gross_amount::numeric >= 100000 then 20 else 0 end
    )::int as score
  from pair_activity pa
  join trading_accounts ta on ta.id = pa.pair_account_a
  join trading_accounts rb on rb.id = pa.pair_account_b
  left join opposite_direction od
    on od.pair_account_a = pa.pair_account_a
    and od.pair_account_b = pa.pair_account_b
  left join shared_device_pairs sdp
    on (
      sdp.user_a = ta.user_id and sdp.user_b = rb.user_id
    ) or (
      sdp.user_a = rb.user_id and sdp.user_b = ta.user_id
    )
  order by score desc, pa.trade_count desc
  limit ${options.limit}
`);

const findings: DetectorFinding[] = rowsOf<CollusionRow>(result)
  .filter((row) => toNumber(row.score) >= options.minScore)
  .map((row) => ({
    type: "collusion",
    severity: severityForScore(toNumber(row.score)),
    score: toNumber(row.score),
    title: "Cross-account collusion risk threshold exceeded",
    description:
      "Counterparty trade pattern indicates possible coordinated activity between mock trading accounts.",
    detector,
    detectorVersion,
    userId: row.userId,
    accountId: row.accountId,
    relatedUserId: row.relatedUserId,
    relatedAccountId: row.relatedAccountId,
    evidence: {
      tradeCount: row.tradeCount,
      instrumentCount: row.instrumentCount,
      grossAmount: row.grossAmount,
      sameDeviceMatched: row.sameDeviceMatched,
      oppositeDirectionCount: row.oppositeDirectionCount,
    },
  }));

await closeFraudScript(detector, options, findings);
