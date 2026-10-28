/**
 * Plain-text logger: exactly one line per event, so logs stay greppable and
 * never interleave across lines.
 *
 *   2026-10-29T10:15:02.114Z INFO  http request method=GET path=/api/v1/me status=200 ms=12
 *
 * Fields are `key=value`; values containing spaces, quotes or `=` are quoted,
 * and newlines are escaped so a single event can't span lines.
 * LOG_LEVEL (debug | info | warn | error | silent) sets the minimum level;
 * default info.
 */

export type Level = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const order: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};
const SILENT = 100;

function readThreshold() {
  const value = process.env.LOG_LEVEL?.trim().toLowerCase();
  if (value === "silent") return SILENT;
  return value && value in order ? order[value as Level] : order.info;
}

let threshold = readThreshold();

/** Re-read LOG_LEVEL (for tests). */
export function reloadLogLevel() {
  threshold = readThreshold();
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return formatValue(describeError(value));
  const text =
    typeof value === "string"
      ? value
      : typeof value === "object"
        ? safeJson(value)
        : String(value);
  const escaped = text.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n");
  return escaped === "" || /[\s"=]/.test(escaped)
    ? `"${escaped.replace(/"/g, '\\"')}"`
    : escaped;
}

export function formatLine(
  level: Level,
  message: string,
  fields: LogFields = {},
  now = new Date(),
) {
  const pairs = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatValue(value)}`);
  return [
    now.toISOString(),
    level.toUpperCase().padEnd(5),
    message.replace(/\r?\n/g, " "),
    ...pairs,
  ].join(" ");
}

function write(level: Level, message: string, fields?: LogFields) {
  if (order[level] < threshold) return;
  const line = `${formatLine(level, message, withStack(fields))}\n`;
  if (level === "error" || level === "warn") process.stderr.write(line);
  else process.stdout.write(line);
}

// Stack traces are multi-line; include them (escaped onto the same line) only
// when LOG_STACKS=1.
function withStack(fields?: LogFields) {
  if (!fields || process.env.LOG_STACKS !== "1") return fields;
  const error = Object.values(fields).find((v) => v instanceof Error) as
    | Error
    | undefined;
  return error?.stack ? { ...fields, stack: error.stack } : fields;
}

/**
 * `Name: first line of message`, plus the cause's first line. Only the first
 * line is kept: driver errors put query parameters (session tokens, emails)
 * on the following lines.
 */
export function describeError(error: Error): string {
  const head = `${error.name}: ${error.message.split("\n")[0]?.trim() ?? ""}`;
  return error.cause instanceof Error
    ? `${head} (cause: ${describeError(error.cause)})`
    : head;
}

function safeJson(value: object) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const log = {
  debug: (message: string, fields?: LogFields) =>
    write("debug", message, fields),
  info: (message: string, fields?: LogFields) => write("info", message, fields),
  warn: (message: string, fields?: LogFields) => write("warn", message, fields),
  error: (message: string, fields?: LogFields) =>
    write("error", message, fields),
};
