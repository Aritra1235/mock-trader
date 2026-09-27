import { createHash, randomUUID } from "node:crypto";
import { db, pool } from "../../../src/db";
import { fraudAlerts } from "../../../src/db/schemas/fraud/fraud";

export type FraudAlertType =
  | "account_integrity"
  | "session_anomaly"
  | "leaderboard_abuse"
  | "trade_abuse"
  | "market_manipulation"
  | "collusion"
  | "policy_violation";

export type FraudAlertSeverity =
  | "info"
  | "low"
  | "medium"
  | "high"
  | "critical";

export type DetectorOptions = {
  windowHours: number;
  minScore: number;
  limit: number;
  persist: boolean;
  now: Date;
  since: Date;
};

export type DetectorFinding = {
  type: FraudAlertType;
  severity: FraudAlertSeverity;
  score: number;
  title: string;
  description: string;
  detector: string;
  detectorVersion: string;
  userId?: string | null;
  accountId?: string | null;
  sessionId?: string | null;
  competitionId?: string | null;
  leaderboardEntryId?: string | null;
  portfolioSnapshotId?: string | null;
  orderId?: string | null;
  tradeId?: string | null;
  relatedAccountId?: string | null;
  relatedUserId?: string | null;
  evidence: Record<string, unknown>;
  firstDetectedAt?: Date;
  lastDetectedAt?: Date;
};

export function readDetectorOptions(defaultWindowHours = 24): DetectorOptions {
  const args = new Map(
    Bun.argv
      .slice(2)
      .filter((arg) => arg.startsWith("--") && arg.includes("="))
      .map((arg) => {
        const [key, value] = arg.slice(2).split("=", 2);
        return [key, value] as const;
      }),
  );

  const now = new Date();
  const windowHours = positiveNumber(
    args.get("window-hours"),
    defaultWindowHours,
  );
  const minScore = positiveNumber(args.get("min-score"), 60);
  const limit = positiveNumber(args.get("limit"), 100);

  return {
    windowHours,
    minScore,
    limit,
    persist: Bun.argv.includes("--persist"),
    now,
    since: new Date(now.getTime() - windowHours * 60 * 60 * 1000),
  };
}

export function severityForScore(score: number): FraudAlertSeverity {
  if (score >= 90) {
    return "critical";
  }
  if (score >= 80) {
    return "high";
  }
  if (score >= 60) {
    return "medium";
  }
  if (score >= 30) {
    return "low";
  }
  return "info";
}

export function toNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }

  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows: T[] }).rows;
  }

  return [];
}

export function makeDeduplicationKey(finding: DetectorFinding): string {
  const stable = [
    finding.detector,
    finding.type,
    finding.userId ?? "",
    finding.accountId ?? "",
    finding.sessionId ?? "",
    finding.competitionId ?? "",
    finding.leaderboardEntryId ?? "",
    finding.portfolioSnapshotId ?? "",
    finding.orderId ?? "",
    finding.tradeId ?? "",
    finding.relatedAccountId ?? "",
    finding.relatedUserId ?? "",
    finding.title,
  ].join(":");

  return createHash("sha256").update(stable).digest("hex");
}

export async function persistFindings(findings: DetectorFinding[]) {
  if (findings.length === 0) {
    return;
  }

  await db
    .insert(fraudAlerts)
    .values(
      findings.map((finding) => {
        const now = new Date();

        return {
          id: randomUUID(),
          deduplicationKey: makeDeduplicationKey(finding),
          type: finding.type,
          severity: finding.severity,
          status: "open",
          score: Math.round(finding.score),
          title: finding.title,
          description: finding.description,
          detector: finding.detector,
          detectorVersion: finding.detectorVersion,
          userId: finding.userId ?? null,
          accountId: finding.accountId ?? null,
          sessionId: finding.sessionId ?? null,
          competitionId: finding.competitionId ?? null,
          leaderboardEntryId: finding.leaderboardEntryId ?? null,
          portfolioSnapshotId: finding.portfolioSnapshotId ?? null,
          orderId: finding.orderId ?? null,
          tradeId: finding.tradeId ?? null,
          relatedAccountId: finding.relatedAccountId ?? null,
          relatedUserId: finding.relatedUserId ?? null,
          evidence: finding.evidence,
          firstDetectedAt: finding.firstDetectedAt ?? now,
          lastDetectedAt: finding.lastDetectedAt ?? now,
        };
      }),
    )
    .onConflictDoNothing({ target: fraudAlerts.deduplicationKey });
}

export function printFindings(
  detector: string,
  options: DetectorOptions,
  findings: DetectorFinding[],
) {
  console.log(
    JSON.stringify(
      {
        detector,
        generatedAt: options.now.toISOString(),
        windowHours: options.windowHours,
        minScore: options.minScore,
        persisted: options.persist,
        count: findings.length,
        findings,
      },
      null,
      2,
    ),
  );
}

export async function closeFraudScript(
  detector: string,
  options: DetectorOptions,
  findings: DetectorFinding[],
) {
  if (options.persist) {
    await persistFindings(findings);
  }

  printFindings(detector, options, findings);
  await pool.end();
}

function positiveNumber(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
