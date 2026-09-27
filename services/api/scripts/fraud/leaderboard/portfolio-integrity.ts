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

const detector = "portfolio-integrity-risk";
const detectorVersion = "2026-07-10.1";
const options = readDetectorOptions(24);

type PortfolioIntegrityRow = {
  portfolioSnapshotId: string;
  leaderboardEntryId: string | null;
  competitionId: string | null;
  accountId: string;
  userId: string;
  startingBalance: string;
  mockCashBalance: string;
  positionsValue: string;
  equity: string;
  returnPct: string;
  expectedReturnPct: string;
  returnPctDrift: string;
  equityDrift: string;
  leaderboardEquity: string | null;
  leaderboardReturnPct: string | null;
  score: number;
};

const result = await db.execute(sql<PortfolioIntegrityRow>`
  with recent_snapshots as (
    select
      ps.*,
      ta.user_id,
      ta.starting_balance,
      abs((ps.mock_cash_balance::numeric + ps.positions_value::numeric) - ps.equity::numeric) as equity_drift,
      case
        when ta.starting_balance::numeric > 0
        then ((ps.equity::numeric - ta.starting_balance::numeric) / ta.starting_balance::numeric) * 100
        else 0
      end as expected_return_pct
    from portfolio_snapshots ps
    join trading_accounts ta on ta.id = ps.account_id
    where ps.snapshot_at >= ${options.since}
  ),
  latest_leaderboard as (
    select distinct on (account_id, competition_id)
      id,
      account_id,
      competition_id,
      equity,
      return_pct,
      calculated_at
    from leaderboard_entries
    where calculated_at >= ${options.since}
    order by account_id, competition_id, calculated_at desc
  )
  select
    rs.id as "portfolioSnapshotId",
    le.id as "leaderboardEntryId",
    rs.competition_id as "competitionId",
    rs.account_id as "accountId",
    rs.user_id as "userId",
    rs.starting_balance as "startingBalance",
    rs.mock_cash_balance as "mockCashBalance",
    rs.positions_value as "positionsValue",
    rs.equity,
    rs.return_pct as "returnPct",
    rs.expected_return_pct::text as "expectedReturnPct",
    abs(rs.return_pct::numeric - rs.expected_return_pct)::text as "returnPctDrift",
    rs.equity_drift::text as "equityDrift",
    le.equity as "leaderboardEquity",
    le.return_pct as "leaderboardReturnPct",
    (
      case when rs.equity::numeric < 0 then 45 else 0 end +
      case when rs.equity_drift > 1 then 35 when rs.equity_drift > 0.01 then 15 else 0 end +
      case when abs(rs.return_pct::numeric - rs.expected_return_pct) > 5 then 35
           when abs(rs.return_pct::numeric - rs.expected_return_pct) > 1 then 20
           else 0
      end +
      case
        when le.id is not null and abs(le.equity::numeric - rs.equity::numeric) > 1 then 25
        else 0
      end +
      case
        when le.id is not null and abs(le.return_pct::numeric - rs.return_pct::numeric) > 1 then 25
        else 0
      end
    )::int as score
  from recent_snapshots rs
  left join latest_leaderboard le
    on le.account_id = rs.account_id
    and (
      le.competition_id = rs.competition_id
      or (le.competition_id is null and rs.competition_id is null)
    )
  order by score desc, rs.snapshot_at desc
  limit ${options.limit}
`);

const findings: DetectorFinding[] = rowsOf<PortfolioIntegrityRow>(result)
  .filter((row) => toNumber(row.score) >= options.minScore)
  .map((row) => ({
    type: "leaderboard_abuse",
    severity: severityForScore(toNumber(row.score)),
    score: toNumber(row.score),
    title: "Portfolio valuation integrity risk threshold exceeded",
    description:
      "Portfolio snapshot math or leaderboard valuation differs from expected mock-account accounting.",
    detector,
    detectorVersion,
    userId: row.userId,
    accountId: row.accountId,
    competitionId: row.competitionId,
    leaderboardEntryId: row.leaderboardEntryId,
    portfolioSnapshotId: row.portfolioSnapshotId,
    evidence: {
      startingBalance: row.startingBalance,
      mockCashBalance: row.mockCashBalance,
      positionsValue: row.positionsValue,
      equity: row.equity,
      returnPct: row.returnPct,
      expectedReturnPct: row.expectedReturnPct,
      returnPctDrift: row.returnPctDrift,
      equityDrift: row.equityDrift,
      leaderboardEquity: row.leaderboardEquity,
      leaderboardReturnPct: row.leaderboardReturnPct,
    },
  }));

await closeFraudScript(detector, options, findings);
