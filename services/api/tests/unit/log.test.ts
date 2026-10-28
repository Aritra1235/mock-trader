import { expect, test } from "bun:test";
import { formatLine, formatValue } from "../../src/lib/log";

test("a log entry is one plain-text line with key=value fields", () => {
  const line = formatLine(
    "info",
    "http request",
    { method: "GET", path: "/api/v1/me", status: 200, ms: 12, ip: undefined },
    new Date("2026-10-29T10:15:02.114Z"),
  );
  expect(line).toBe(
    "2026-10-29T10:15:02.114Z INFO  http request method=GET path=/api/v1/me status=200 ms=12",
  );
});

test("values that would break the line or the key=value shape are quoted and escaped", () => {
  expect(formatValue("two words")).toBe('"two words"');
  expect(formatValue('say "hi"')).toBe('"say \\"hi\\""');
  expect(formatValue("a=b")).toBe('"a=b"');
  expect(formatValue("line one\nline two")).toBe('"line one\\nline two"');
  expect(formatValue("")).toBe('""');
  expect(formatValue(null)).toBe("-");
  expect(formatValue(new Error("boom"))).toBe('"Error: boom"');
  expect(formatValue({ a: 1 })).toBe('"{\\"a\\":1}"');

  const line = formatLine("error", "multi\nline", { text: "a\nb" });
  expect(line.split("\n")).toHaveLength(1);
});

test("errors keep only their first line, so query parameters never reach the log", () => {
  const cause = new Error('relation "user" does not exist');
  const error = new Error(
    "Failed query: select * from session where token = $1\nparams: secret-session-token",
    { cause },
  );
  const value = formatValue(error);
  expect(value).not.toContain("secret-session-token");
  expect(value).toContain(
    "Failed query: select * from session where token = $1",
  );
  expect(value).toContain('cause: Error: relation \\"user\\" does not exist');
});
