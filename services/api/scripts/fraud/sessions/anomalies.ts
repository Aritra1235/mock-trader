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

const detector = "session-anomaly-risk";
const detectorVersion = "2026-07-10.1";
const options = readDetectorOptions(24);

type SessionRiskRow = {
  sessionId: string;
  userId: string;
  deviceFingerprint: string | null;
  geoCountry: string | null;
  riskScore: number;
  deviceTrustScore: number;
  activeSessionsForUser: number;
  countriesForUser: number;
  devicesForUser: number;
  score: number;
};

const result = await db.execute(sql<SessionRiskRow>`
  with active_session_counts as (
    select
      user_id,
      count(*)::int as active_sessions_for_user,
      count(distinct geo_country) filter (where geo_country is not null)::int as countries_for_user,
      count(distinct device_fingerprint) filter (where device_fingerprint is not null)::int as devices_for_user
    from "session"
    where expires_at > ${options.now}
    group by user_id
  )
  select
    s.id as "sessionId",
    s.user_id as "userId",
    s.device_fingerprint as "deviceFingerprint",
    s.geo_country as "geoCountry",
    coalesce(s.risk_score, 0)::int as "riskScore",
    coalesce(s.device_trust_score, 0)::int as "deviceTrustScore",
    coalesce(ascs.active_sessions_for_user, 0)::int as "activeSessionsForUser",
    coalesce(ascs.countries_for_user, 0)::int as "countriesForUser",
    coalesce(ascs.devices_for_user, 0)::int as "devicesForUser",
    (
      least(coalesce(s.risk_score, 0), 70) +
      case when s.device_fingerprint is null then 20 else 0 end +
      case when coalesce(s.device_trust_score, 0) < 0 then 20 else 0 end +
      case when coalesce(ascs.countries_for_user, 0) >= 3 then 35 else 0 end +
      case when coalesce(ascs.devices_for_user, 0) >= 5 then 25 else 0 end +
      case when coalesce(ascs.active_sessions_for_user, 0) >= 8 then 20 else 0 end
    )::int as score
  from "session" s
  left join active_session_counts ascs on ascs.user_id = s.user_id
  where s.expires_at > ${options.now}
    and s.created_at >= ${options.since}
  order by score desc, s.created_at desc
  limit ${options.limit}
`);

const findings: DetectorFinding[] = rowsOf<SessionRiskRow>(result)
  .filter((row) => toNumber(row.score) >= options.minScore)
  .map((row) => ({
    type: "session_anomaly",
    severity: severityForScore(toNumber(row.score)),
    score: toNumber(row.score),
    title: "Session anomaly risk threshold exceeded",
    description:
      "Active session characteristics indicate unusual geography, device churn, or elevated auth risk.",
    detector,
    detectorVersion,
    userId: row.userId,
    sessionId: row.sessionId,
    evidence: {
      deviceFingerprintPresent: Boolean(row.deviceFingerprint),
      geoCountry: row.geoCountry,
      riskScore: row.riskScore,
      deviceTrustScore: row.deviceTrustScore,
      activeSessionsForUser: row.activeSessionsForUser,
      countriesForUser: row.countriesForUser,
      devicesForUser: row.devicesForUser,
    },
  }));

await closeFraudScript(detector, options, findings);
