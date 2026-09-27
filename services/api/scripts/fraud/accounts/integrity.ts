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

const detector = "account-integrity-risk";
const detectorVersion = "2026-07-10.2";
const options = readDetectorOptions(168);

type AccountIntegrityRow = {
  accountId: string;
  userId: string;
  accountStatus: string;
  riskTier: string;
  leaderboardEligible: boolean;
  resetCount: number;
  mockCashBalance: string;
  mockBuyingPower: string;
  reservedMockCash: string;
  openAlertCount: number;
  accountsForUser: number;
  sharedDeviceUsers: number;
  ledgerAdjustmentCount: number;
  score: number;
};

const result = await db.execute(sql<AccountIntegrityRow>`
  with open_alerts as (
    select
      account_id,
      count(*)::int as open_alert_count
    from fraud_alerts
    where status in ('open', 'investigating')
    group by account_id
  ),
  user_account_counts as (
    select
      user_id,
      count(*)::int as accounts_for_user
    from trading_accounts
    group by user_id
  ),
  shared_devices as (
    select
      td.user_id,
      max(device_users)::int as shared_device_users
    from (
      select
        fingerprint_hash,
        count(distinct user_id)::int as device_users
      from trusted_devices
      where revoked_at is null
      group by fingerprint_hash
    ) device_counts
    join trusted_devices td on td.fingerprint_hash = device_counts.fingerprint_hash
    where td.revoked_at is null
    group by td.user_id
  ),
  ledger_adjustments as (
    select
      account_id,
      count(*) filter (
        where type in ('admin_adjustment', 'leaderboard_adjustment', 'reset_credit')
      )::int as ledger_adjustment_count
    from mock_cash_ledger_entries
    where occurred_at >= ${options.since}
    group by account_id
  )
  select
    ta.id as "accountId",
    ta.user_id as "userId",
    ta.status as "accountStatus",
    ta.risk_tier as "riskTier",
    ta.leaderboard_eligible as "leaderboardEligible",
    ta.reset_count as "resetCount",
    ta.mock_cash_balance as "mockCashBalance",
    ta.mock_buying_power as "mockBuyingPower",
    ta.reserved_mock_cash as "reservedMockCash",
    coalesce(oa.open_alert_count, 0)::int as "openAlertCount",
    coalesce(uac.accounts_for_user, 0)::int as "accountsForUser",
    coalesce(sd.shared_device_users, 1)::int as "sharedDeviceUsers",
    coalesce(la.ledger_adjustment_count, 0)::int as "ledgerAdjustmentCount",
    (
      case when ta.status in ('restricted', 'suspended') then 35 else 0 end +
      case when ta.leaderboard_eligible = false then 35 else 0 end +
      case when ta.risk_tier = 'critical' then 45 when ta.risk_tier = 'high' then 30 else 0 end +
      least(coalesce(oa.open_alert_count, 0) * 12, 36) +
      case when coalesce(uac.accounts_for_user, 0) >= 5 then 25 else 0 end +
      case when coalesce(sd.shared_device_users, 1) >= 3 then 30 else 0 end +
      least(ta.reset_count * 15, 45) +
      least(coalesce(la.ledger_adjustment_count, 0) * 15, 45) +
      case
        when ta.mock_cash_balance::numeric < 0
          or ta.mock_buying_power::numeric < 0
          or ta.reserved_mock_cash::numeric < 0
        then 35
        else 0
      end
    )::int as score
  from trading_accounts ta
  left join open_alerts oa on oa.account_id = ta.id
  left join user_account_counts uac on uac.user_id = ta.user_id
  left join shared_devices sd on sd.user_id = ta.user_id
  left join ledger_adjustments la on la.account_id = ta.id
  order by score desc, ta.updated_at desc
  limit ${options.limit}
`);

const findings: DetectorFinding[] = rowsOf<AccountIntegrityRow>(result)
  .filter((row) => toNumber(row.score) >= options.minScore)
  .map((row) => ({
    type: "account_integrity",
    severity: severityForScore(toNumber(row.score)),
    score: toNumber(row.score),
    title: "Mock account integrity risk threshold exceeded",
    description:
      "Paper account state, reset history, adjustment history, shared-device evidence, or leaderboard eligibility indicates elevated integrity risk.",
    detector,
    detectorVersion,
    userId: row.userId,
    accountId: row.accountId,
    evidence: {
      accountStatus: row.accountStatus,
      riskTier: row.riskTier,
      leaderboardEligible: row.leaderboardEligible,
      resetCount: row.resetCount,
      mockCashBalance: row.mockCashBalance,
      mockBuyingPower: row.mockBuyingPower,
      reservedMockCash: row.reservedMockCash,
      openAlertCount: row.openAlertCount,
      accountsForUser: row.accountsForUser,
      sharedDeviceUsers: row.sharedDeviceUsers,
      ledgerAdjustmentCount: row.ledgerAdjustmentCount,
    },
  }));

await closeFraudScript(detector, options, findings);
