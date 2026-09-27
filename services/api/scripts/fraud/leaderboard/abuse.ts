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

const detector = "leaderboard-abuse-risk";
const detectorVersion = "2026-07-10.1";
const options = readDetectorOptions(24);

type LeaderboardRiskRow = {
  leaderboardEntryId: string;
  portfolioSnapshotId: string | null;
  competitionId: string | null;
  accountId: string;
  userId: string;
  rank: number;
  previousRank: number | null;
  eligible: boolean;
  leaderboardEligible: boolean;
  resetCount: number;
  equity: string;
  returnPct: string;
  previousEquity: string | null;
  equityJumpPct: string | null;
  sameDeviceAccounts: number;
  score: number;
};

const result = await db.execute(sql<LeaderboardRiskRow>`
  with ranked_snapshots as (
    select
      ps.*,
      lag(ps.equity) over (
        partition by ps.account_id, ps.competition_id
        order by ps.snapshot_at
      ) as previous_equity
    from portfolio_snapshots ps
    where ps.snapshot_at >= ${options.since}
  ),
  latest_snapshot as (
    select distinct on (account_id, competition_id)
      id,
      account_id,
      competition_id,
      equity,
      previous_equity,
      case
        when previous_equity is not null and previous_equity::numeric > 0
        then ((equity::numeric - previous_equity::numeric) / previous_equity::numeric) * 100
        else null
      end as equity_jump_pct
    from ranked_snapshots
    order by account_id, competition_id, snapshot_at desc
  ),
  device_reuse as (
    select
      td.user_id,
      max(dc.device_users)::int as same_device_accounts
    from trusted_devices td
    join (
      select
        fingerprint_hash,
        count(distinct user_id)::int as device_users
      from trusted_devices
      where revoked_at is null
      group by fingerprint_hash
    ) dc on dc.fingerprint_hash = td.fingerprint_hash
    where td.revoked_at is null
    group by td.user_id
  )
  select
    le.id as "leaderboardEntryId",
    ls.id as "portfolioSnapshotId",
    le.competition_id as "competitionId",
    le.account_id as "accountId",
    le.user_id as "userId",
    le.rank,
    le.previous_rank as "previousRank",
    le.eligible,
    ta.leaderboard_eligible as "leaderboardEligible",
    ta.reset_count as "resetCount",
    le.equity,
    le.return_pct as "returnPct",
    ls.previous_equity::text as "previousEquity",
    ls.equity_jump_pct::text as "equityJumpPct",
    coalesce(max(dr.same_device_accounts), 1)::int as "sameDeviceAccounts",
    (
      case when le.eligible = false or ta.leaderboard_eligible = false then 45 else 0 end +
      case when ta.reset_count > 0 and le.rank <= 25 then least(ta.reset_count * 20, 50) else 0 end +
      case when le.previous_rank is not null and le.previous_rank - le.rank >= 50 then 25 else 0 end +
      case when ls.equity_jump_pct is not null and ls.equity_jump_pct >= 75 then 45
           when ls.equity_jump_pct is not null and ls.equity_jump_pct >= 35 then 25
           else 0
      end +
      case when le.return_pct::numeric >= 250 then 35
           when le.return_pct::numeric >= 100 then 20
           else 0
      end +
      case when coalesce(max(dr.same_device_accounts), 1) >= 3 then 30 else 0 end +
      least(le.risk_score, 40)
    )::int as score
  from leaderboard_entries le
  join trading_accounts ta on ta.id = le.account_id
  left join latest_snapshot ls
    on ls.account_id = le.account_id
    and (
      ls.competition_id = le.competition_id
      or (ls.competition_id is null and le.competition_id is null)
    )
  left join device_reuse dr on dr.user_id = le.user_id
  where le.calculated_at >= ${options.since}
  group by
    le.id,
    ls.id,
    le.competition_id,
    le.account_id,
    le.user_id,
    le.rank,
    le.previous_rank,
    le.eligible,
    ta.leaderboard_eligible,
    ta.reset_count,
    le.equity,
    le.return_pct,
    ls.previous_equity,
    ls.equity_jump_pct,
    le.risk_score
  order by score desc, le.rank asc
  limit ${options.limit}
`);

const findings: DetectorFinding[] = rowsOf<LeaderboardRiskRow>(result)
  .filter((row) => toNumber(row.score) >= options.minScore)
  .map((row) => ({
    type: "leaderboard_abuse",
    severity: severityForScore(toNumber(row.score)),
    score: toNumber(row.score),
    title: "Leaderboard integrity risk threshold exceeded",
    description:
      "Ranking evidence indicates possible reset abuse, ineligible ranking, impossible portfolio jump, shared-device abuse, or inflated return.",
    detector,
    detectorVersion,
    userId: row.userId,
    accountId: row.accountId,
    competitionId: row.competitionId,
    leaderboardEntryId: row.leaderboardEntryId,
    portfolioSnapshotId: row.portfolioSnapshotId,
    evidence: {
      rank: row.rank,
      previousRank: row.previousRank,
      eligible: row.eligible,
      leaderboardEligible: row.leaderboardEligible,
      resetCount: row.resetCount,
      equity: row.equity,
      returnPct: row.returnPct,
      previousEquity: row.previousEquity,
      equityJumpPct: row.equityJumpPct,
      sameDeviceAccounts: row.sameDeviceAccounts,
    },
  }));

await closeFraudScript(detector, options, findings);
