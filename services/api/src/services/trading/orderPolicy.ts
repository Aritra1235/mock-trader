import { MVP_PRODUCT } from "../../config/product";

const IST_OFFSET_MS = 330 * 60_000;
const SESSION_OPEN_MINUTES = 9 * 60 + 15;
const SESSION_CLOSE_MINUTES = 15 * 60 + 30;
const INTRADAY_ENTRY_CUTOFF_MINUTES = clockMinutes(
  MVP_PRODUCT.intraday.entryCutoff,
);
const INTRADAY_SQUARE_OFF_MINUTES = clockMinutes(
  MVP_PRODUCT.intraday.squareOffAt,
);

/** Share of an intraday position's value blocked as margin (1 / leverage). */
export const INTRADAY_MARGIN_RATE = 1 / MVP_PRODUCT.intraday.leverage;

function clockMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function istClock(now: Date) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const day = ist.getUTCDay();
  return {
    weekday: day >= 1 && day <= 5,
    minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
  };
}

/** Today's IST wall-clock time as an instant. */
function istToday(now: Date, minutes: number) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  ist.setUTCHours(0, minutes, 0, 0);
  return new Date(ist.getTime() - IST_OFFSET_MS);
}

// The simulator uses the same weekday session as the trading UI. Exchange
// holidays and special sessions are not modelled.
export function isOrderSessionOpen(now: Date) {
  const { weekday, minutes } = istClock(now);
  return (
    weekday &&
    minutes >= SESSION_OPEN_MINUTES &&
    minutes < SESSION_CLOSE_MINUTES
  );
}

/** New intraday exposure is only accepted until the entry cutoff. */
export function isIntradayEntryOpen(now: Date) {
  const { weekday, minutes } = istClock(now);
  return (
    weekday &&
    minutes >= SESSION_OPEN_MINUTES &&
    minutes < INTRADAY_ENTRY_CUTOFF_MINUTES
  );
}

/** When resting intraday orders expire: today's square-off time. */
export function intradayOrderExpiry(now: Date) {
  return istToday(now, INTRADAY_SQUARE_OFF_MINUTES);
}

/**
 * An intraday position must be closed once today's square-off time passes, or
 * whenever it was last touched before today's session opened (for example if
 * the server was down at square-off), so it never carries into a new session.
 */
export function isIntradaySquareOffDue(now: Date, lastActivity: Date) {
  const { weekday, minutes } = istClock(now);
  const holding =
    weekday &&
    minutes >= SESSION_OPEN_MINUTES &&
    minutes < INTRADAY_SQUARE_OFF_MINUTES;
  return !holding || lastActivity < istToday(now, SESSION_OPEN_MINUTES);
}

/** After-hours Day orders belong to the next weekday session. */
export function dayOrderExpiry(now: Date) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  ist.setUTCHours(15, 30, 0, 0);
  if (ist.getTime() - IST_OFFSET_MS <= now.getTime()) {
    ist.setUTCDate(ist.getUTCDate() + 1);
  }
  while (ist.getUTCDay() === 0 || ist.getUTCDay() === 6) {
    ist.setUTCDate(ist.getUTCDate() + 1);
  }
  return new Date(ist.getTime() - IST_OFFSET_MS);
}

export function limitPriceMatches(
  side: "buy" | "sell",
  limitPrice: number,
  quotePrice: number,
) {
  return side === "buy" ? quotePrice <= limitPrice : quotePrice >= limitPrice;
}
