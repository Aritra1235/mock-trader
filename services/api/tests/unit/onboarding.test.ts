import { expect, test } from "bun:test";
import { TERMS } from "../../src/services/onboarding/onboardingOptions";
import {
  ageOn,
  parseExperience,
  parsePreferences,
  parseProfile,
  stepComplete,
} from "../../src/services/onboarding/onboardingService";

const validProfile = {
  fullName: "  Aritra   Bhattacharya ",
  dateOfBirth: "2000-05-14",
  phone: "+91 98765-43210",
  city: "Kolkata",
  state: "West Bengal",
  occupation: "salaried",
};

test("age is counted in whole years and rejects impossible dates", () => {
  const today = new Date("2026-10-29T00:00:00Z");
  expect(ageOn("2008-10-29", today)).toBe(18);
  expect(ageOn("2008-10-30", today)).toBe(17);
  expect(ageOn("2001-02-30", today)).toBeNull();
  expect(ageOn("2030-01-01", today)).toBeNull();
  expect(ageOn("29-10-2000", today)).toBeNull();
});

test("profile normalises name and phone and enforces the minimum age", () => {
  expect(parseProfile(validProfile)).toEqual({
    fullName: "Aritra Bhattacharya",
    dateOfBirth: "2000-05-14",
    phone: "+919876543210",
    city: "Kolkata",
    state: "West Bengal",
    occupation: "salaried",
  });
  expect(parseProfile({ ...validProfile, phone: "" }).phone).toBeNull();

  const thisYear = new Date().getUTCFullYear();
  expect(() =>
    parseProfile({ ...validProfile, dateOfBirth: `${thisYear - 10}-01-01` }),
  ).toThrow("at least 18");
  expect(() => parseProfile({ ...validProfile, phone: "12345" })).toThrow(
    "mobile number",
  );
  expect(() => parseProfile({ ...validProfile, state: "Atlantis" })).toThrow();
  expect(() => parseProfile({ ...validProfile, fullName: "A1" })).toThrow();
});

test("experience requires instruments unless the user is new", () => {
  expect(
    parseExperience({
      experienceLevel: "none",
      instrumentsTraded: ["options"],
      tradingStyle: "swing",
    }).instrumentsTraded,
  ).toEqual([]);
  expect(() =>
    parseExperience({
      experienceLevel: "beginner",
      instrumentsTraded: [],
      tradingStyle: "swing",
    }),
  ).toThrow("instruments");
  expect(() =>
    parseExperience({
      experienceLevel: "beginner",
      instrumentsTraded: ["crypto"],
      tradingStyle: "swing",
    }),
  ).toThrow("unknown option");
});

test("preferences only accept offered capitals and at least one goal", () => {
  expect(
    parsePreferences({
      tradingGoals: ["learn_basics", "learn_basics"],
      riskAppetite: "moderate",
      startingCapital: 500_000,
    }),
  ).toEqual({
    tradingGoals: ["learn_basics"],
    riskAppetite: "moderate",
    startingCapital: 500_000,
  });
  expect(() =>
    parsePreferences({
      tradingGoals: ["learn_basics"],
      riskAppetite: "moderate",
      startingCapital: 99_999_999,
    }),
  ).toThrow("starting capital");
  expect(() =>
    parsePreferences({
      tradingGoals: [],
      riskAppetite: "moderate",
      startingCapital: 500_000,
    }),
  ).toThrow("goal");
});

test("agreements only count for the current terms version", () => {
  const row = {
    termsVersion: TERMS.version,
    termsAcceptedAt: new Date(),
    riskDisclosureAcceptedAt: new Date(),
  } as Parameters<typeof stepComplete>[1];
  expect(stepComplete("agreements", row)).toBeTrue();
  expect(
    stepComplete("agreements", { ...row, termsVersion: "2020-01-01" } as never),
  ).toBeFalse();
  expect(stepComplete("profile", undefined)).toBeFalse();
});
