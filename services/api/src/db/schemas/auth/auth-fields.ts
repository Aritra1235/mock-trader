import type { DBFieldAttribute } from "@better-auth/core/db";

export const authUserAdditionalFields = {
  tradingStatus: {
    type: "string",
    required: false,
    defaultValue: "active",
    input: false,
    fieldName: "trading_status",
  },
  leaderboardStatus: {
    type: "string",
    required: false,
    defaultValue: "eligible",
    input: false,
    fieldName: "leaderboard_status",
  },
  riskTier: {
    type: "string",
    required: false,
    defaultValue: "low",
    input: false,
    fieldName: "risk_tier",
  },
  fraudReviewStatus: {
    type: "string",
    required: false,
    defaultValue: "clear",
    input: false,
    fieldName: "fraud_review_status",
  },
  lastRiskReviewAt: {
    type: "date",
    required: false,
    input: false,
    fieldName: "last_risk_review_at",
  },
} satisfies Record<string, DBFieldAttribute>;

export const authSessionAdditionalFields = {
  deviceFingerprint: {
    type: "string",
    required: false,
    input: false,
    fieldName: "device_fingerprint",
  },
  deviceTrustScore: {
    type: "number",
    required: false,
    defaultValue: 0,
    input: false,
    fieldName: "device_trust_score",
  },
  geoCountry: {
    type: "string",
    required: false,
    input: false,
    fieldName: "geo_country",
  },
  geoRegion: {
    type: "string",
    required: false,
    input: false,
    fieldName: "geo_region",
  },
  riskScore: {
    type: "number",
    required: false,
    defaultValue: 0,
    input: false,
    fieldName: "risk_score",
  },
  riskSignals: {
    type: "json",
    required: false,
    input: false,
    fieldName: "risk_signals",
  },
} satisfies Record<string, DBFieldAttribute>;
