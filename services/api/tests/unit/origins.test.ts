import { expect, test } from "bun:test";
import { parseAllowedOrigins, withLoopbackAliases } from "../../src/config/env";

test("APP_ORIGINS accepts multiple trimmed origins and removes duplicates", () => {
  expect(
    parseAllowedOrigins(
      " http://localhost:3001/ , http://127.0.0.1:3001, http://localhost:3001 ",
    ),
  ).toEqual(["http://localhost:3001", "http://127.0.0.1:3001"]);
});

test("APP_ORIGINS rejects paths, wildcards, and empty lists", () => {
  expect(() => parseAllowedOrigins("http://localhost:3001/app")).toThrow();
  expect(() => parseAllowedOrigins("*")).toThrow();
  expect(() => parseAllowedOrigins(" , ")).toThrow();
});

test("a loopback origin also allows its loopback aliases on the same port", () => {
  expect(
    withLoopbackAliases(["http://localhost:3001", "https://app.example.com"]),
  ).toEqual([
    "http://localhost:3001",
    "https://app.example.com",
    "http://127.0.0.1:3001",
    "http://[::1]:3001",
  ]);
});
