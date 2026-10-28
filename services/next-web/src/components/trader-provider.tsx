"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { components } from "@/generated/api-schema";
import { apiClient } from "@/lib/api-client";
import { apiBase, marketSocketUrl } from "@/lib/endpoints";
import {
  type CloseRef,
  type Instrument,
  instrumentFrom,
  num,
  obj,
  type PriceView,
  priceView,
  type QuoteEntry,
  quoteFrom,
  str,
} from "@/lib/market";

export type Account = components["schemas"]["PublicAccount"];
/** The generated schema marks these fields optional; the API always sends them. */
export type Position = Required<components["schemas"]["Position"]>;
export type Order = Required<components["schemas"]["Order"]>;
export type LedgerEntry = Required<components["schemas"]["LedgerEntry"]>;
export type Trade = Record<string, unknown>;
export type AuthState =
  | "loading"
  | "ready"
  | "unauthorized"
  | "verify"
  | "offline";
export type Side = "buy" | "sell";
export type Summary = {
  equity: number | null;
  positionsValue: number | null;
  realizedPnl: number | null;
  unrealizedPnl: number | null;
  returnPct: number | null;
};
export type Toast = {
  id: number;
  tone: "success" | "error" | "info";
  title: string;
  body?: string;
};

type Trader = {
  auth: AuthState;
  userName: string;
  userEmail: string;
  account: Account | null;
  summary: Summary;
  positions: Position[];
  orders: Order[];
  trades: Trade[];
  ledger: LedgerEntry[];
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  instruments: Record<string, Instrument>;
  remember: (items: Instrument[]) => void;
  watchlist: Instrument[];
  isWatched: (instrumentKey: string) => boolean;
  toggleWatch: (instrument: Instrument) => void;
  priceOf: (instrumentKey: string) => PriceView;
  quoteOf: (instrumentKey: string) => QuoteEntry | undefined;
  closeOf: (instrumentKey: string) => CloseRef | undefined;
  trackQuotes: (keys: string[]) => () => void;
  socketConnected: boolean;
  ticket: { instrument: Instrument; side: Side } | null;
  openTicket: (instrument: Instrument, side: Side) => void;
  closeTicket: () => void;
  toasts: Toast[];
  notify: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
};

const TraderContext = createContext<Trader | null>(null);

export function useTrader() {
  const value = useContext(TraderContext);
  if (!value) throw new Error("useTrader must be used inside TraderProvider");
  return value;
}

/** Subscribe the given instruments to quote polling and the live socket while mounted. */
export function useTrackedQuotes(keys: string[]) {
  const { trackQuotes } = useTrader();
  const joined = keys.filter(Boolean).join(",");
  useEffect(() => {
    if (!joined) return;
    return trackQuotes(joined.split(","));
  }, [joined, trackQuotes]);
}

const WATCHLIST_KEY = "mock-trader-watchlist";
const LEGACY_PINS_KEY = "mock-trader-pins";
const MAX_WATCHLIST = 50;
const starterSymbols = [
  "RELIANCE",
  "HDFCBANK",
  "INFY",
  "TCS",
  "ICICIBANK",
  "SBIN",
];
const emptySummary: Summary = {
  equity: null,
  positionsValue: null,
  realizedPnl: null,
  unrealizedPnl: null,
  returnPct: null,
};

/** Resolve a bare symbol to its catalog entry, preferring the NSE equity listing. */
export async function resolveSymbol(symbol: string) {
  const { data } = await apiClient.GET("/api/v1/market/instruments/search", {
    params: { query: { q: symbol, limit: 10 } },
  });
  const matches = (data ?? [])
    .map(instrumentFrom)
    .filter(
      (x): x is Instrument =>
        x !== null && x.symbol.toUpperCase() === symbol.toUpperCase(),
    );
  return (
    matches.find((x) => x.exchange === "NSE" && x.scripType === "EQUITY") ??
    matches.find((x) => x.exchange === "NSE") ??
    matches[0] ??
    null
  );
}

function readSavedWatchlist(): Instrument[] | string[] | null {
  try {
    const saved = JSON.parse(localStorage.getItem(WATCHLIST_KEY) ?? "null");
    if (Array.isArray(saved)) {
      return saved
        .map(instrumentFrom)
        .filter((x): x is Instrument => x !== null);
    }
    const legacy = JSON.parse(localStorage.getItem(LEGACY_PINS_KEY) ?? "null");
    if (Array.isArray(legacy) && legacy.every((x) => typeof x === "string"))
      return legacy;
  } catch {
    /* fall back to defaults */
  }
  return null;
}

export function TraderProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState>("loading");
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [account, setAccount] = useState<Account | null>(null);
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [instruments, setInstruments] = useState<Record<string, Instrument>>(
    {},
  );
  const [watchlist, setWatchlist] = useState<Instrument[]>([]);
  const [watchlistLoaded, setWatchlistLoaded] = useState(false);
  const [tracked, setTracked] = useState<Record<string, number>>({});
  const [quotes, setQuotes] = useState<Record<string, QuoteEntry>>({});
  const [quotesAttempted, setQuotesAttempted] = useState(false);
  const [closes, setCloses] = useState<Record<string, CloseRef>>({});
  const [socketConnected, setSocketConnected] = useState(false);
  const [ticket, setTicket] = useState<Trader["ticket"]>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const requestedInstruments = useRef(new Set<string>());
  const requestedCloses = useRef(new Set<string>());

  const remember = useCallback((items: Instrument[]) => {
    if (items.length === 0) return;
    setInstruments((current) => {
      let changed = false;
      const next = { ...current };
      for (const item of items) {
        if (!next[item.instrumentKey]) {
          next[item.instrumentKey] = item;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, []);

  const dismiss = useCallback(
    (id: number) => setToasts((current) => current.filter((t) => t.id !== id)),
    [],
  );
  const notify = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = ++toastId.current;
      setToasts((current) => [...current.slice(-3), { ...toast, id }]);
      setTimeout(() => dismiss(id), toast.tone === "error" ? 8000 : 5000);
    },
    [dismiss],
  );

  const refresh = useCallback(async () => {
    try {
      // get-session answers 200 with null when signed out, so a signed-out
      // visit doesn't log a 401 from /me in the browser console.
      const session = await fetch(`${apiBase}/api/v1/auth/get-session`, {
        credentials: "include",
      });
      if (session.ok && (await session.json()) === null)
        return setAuth("unauthorized");
      const me = await apiClient.GET("/api/v1/me");
      if (me.response.status === 401) return setAuth("unauthorized");
      if (me.response.status === 403) return setAuth("verify");
      if (!me.data) return setAuth("offline");
      const practice =
        me.data.accounts.find((item) => item.type === "practice") ??
        me.data.accounts[0] ??
        null;
      setAccount(practice);
      setUserName(str(me.data.user.name));
      setUserEmail(str(me.data.user.email));
      setAuth("ready");
      if (!practice) return;
      const path = { accountId: practice.id };
      const [portfolio, orderList, tradeList, activity] = await Promise.all([
        apiClient.GET("/api/v1/me/portfolio"),
        apiClient.GET("/api/v1/accounts/{accountId}/orders", {
          params: { path, query: { limit: 50 } },
        }),
        apiClient.GET("/api/v1/accounts/{accountId}/trades", {
          params: { path, query: { limit: 50 } },
        }),
        apiClient.GET("/api/v1/accounts/{accountId}/activity", {
          params: { path, query: { limit: 50 } },
        }),
      ]);
      const entry = portfolio.data?.accounts
        .map(obj)
        .find((item) => obj(item.account).id === practice.id);
      const s = obj(entry?.summary);
      setSummary({
        equity: num(s.equity),
        positionsValue: num(s.positionsValue),
        realizedPnl: num(s.realizedPnl),
        unrealizedPnl: num(s.unrealizedPnl),
        returnPct: num(s.returnPct) === null ? null : Number(s.returnPct) * 100,
      });
      const accountFromPortfolio = obj(entry?.account);
      if (accountFromPortfolio.id) setAccount(accountFromPortfolio as Account);
      const held = (
        Array.isArray(entry?.positions) ? entry.positions : []
      ) as Position[];
      setPositions(held.filter((p) => (num(p.quantity) ?? 0) !== 0));
      remember(
        held
          .map((p) => instrumentFrom(p.instrument))
          .filter((x): x is Instrument => x !== null),
      );
      setOrders((orderList.data?.orders ?? []) as Order[]);
      setTrades((tradeList.data?.trades ?? []) as Trade[]);
      setLedger((activity.data?.entries ?? []) as LedgerEntry[]);
    } catch {
      setAuth("offline");
    }
  }, [remember]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      const response = await fetch(`${apiBase}/api/v1/auth/sign-out`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Sign out failed");
      setAccount(null);
      setPositions([]);
      setOrders([]);
      setTrades([]);
      setLedger([]);
      setSummary(emptySummary);
      setAuth("unauthorized");
    } catch {
      notify({ tone: "error", title: "Sign out failed", body: "Try again." });
    }
  }, [notify]);

  // Watchlist: restore from storage, migrating the old symbol-only pins.
  useEffect(() => {
    let active = true;
    const saved = readSavedWatchlist();
    if (saved && saved.length > 0 && typeof saved[0] !== "string") {
      setWatchlist(saved as Instrument[]);
      setWatchlistLoaded(true);
      return;
    }
    const symbols = saved ? (saved as string[]) : starterSymbols;
    void Promise.all(
      symbols
        .slice(0, MAX_WATCHLIST)
        .map((s) => resolveSymbol(s).catch(() => null)),
    ).then((items) => {
      if (!active) return;
      setWatchlist(items.filter((x): x is Instrument => x !== null));
      setWatchlistLoaded(true);
    });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!watchlistLoaded) return;
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
    remember(watchlist);
  }, [watchlist, watchlistLoaded, remember]);

  const watchedKeys = useMemo(
    () => new Set(watchlist.map((x) => x.instrumentKey)),
    [watchlist],
  );
  const isWatched = useCallback(
    (key: string) => watchedKeys.has(key),
    [watchedKeys],
  );
  const toggleWatch = useCallback(
    (instrument: Instrument) => {
      setWatchlist((current) => {
        if (current.some((x) => x.instrumentKey === instrument.instrumentKey))
          return current.filter(
            (x) => x.instrumentKey !== instrument.instrumentKey,
          );
        if (current.length >= MAX_WATCHLIST) {
          notify({
            tone: "info",
            title: "Watchlist is full",
            body: `Remove a scrip to add more (max ${MAX_WATCHLIST}).`,
          });
          return current;
        }
        return [...current, instrument];
      });
    },
    [notify],
  );

  // Order and trade rows only carry an instrument key; look up the symbol once.
  useEffect(() => {
    const keys = new Set<string>();
    for (const o of orders) keys.add(o.instrumentId);
    for (const t of trades) keys.add(str(t.instrumentId));
    for (const key of keys) {
      if (!key || instruments[key] || requestedInstruments.current.has(key))
        continue;
      requestedInstruments.current.add(key);
      void apiClient
        .GET("/api/v1/market/instruments/{id}", {
          params: { path: { id: key } },
        })
        .then(({ data }) => {
          const instrument = instrumentFrom(data);
          if (instrument) remember([{ ...instrument, instrumentKey: key }]);
        })
        .catch(() => undefined);
    }
  }, [orders, trades, instruments, remember]);

  const trackQuotes = useCallback((keys: string[]) => {
    setTracked((current) => {
      const next = { ...current };
      for (const key of keys) next[key] = (next[key] ?? 0) + 1;
      return next;
    });
    return () =>
      setTracked((current) => {
        const next = { ...current };
        for (const key of keys) {
          next[key] = (next[key] ?? 1) - 1;
          if (next[key] <= 0) delete next[key];
        }
        return next;
      });
  }, []);

  const quoteKey = useMemo(() => {
    const keys = new Set<string>();
    for (const item of watchlist) keys.add(item.instrumentKey);
    for (const p of positions) if (p.instrumentId) keys.add(p.instrumentId);
    for (const key of Object.keys(tracked)) keys.add(key);
    return [...keys].sort().slice(0, 100).join(",");
  }, [watchlist, positions, tracked]);

  useEffect(() => {
    if (!quoteKey) return;
    let active = true;
    const load = async () => {
      try {
        const response = await apiClient.GET("/api/v1/market/quotes", {
          params: { query: { ids: quoteKey, mode: "QUOTE" } },
        });
        const data = obj(response.data).data;
        if (!active || !Array.isArray(data)) return;
        setQuotes((current) => {
          const next = { ...current };
          for (const item of data) {
            const e = obj(item);
            const key =
              instrumentFrom(e.instrument)?.instrumentKey ??
              str(obj(e.quote).instrumentKey);
            if (key)
              next[key] = {
                quote: quoteFrom(e.quote),
                stale: e.stale === true,
              };
          }
          return next;
        });
      } catch {
        /* keep the last known quotes */
      } finally {
        if (active) setQuotesAttempted(true);
      }
    };
    void load();
    const poll = setInterval(() => void load(), 30_000);
    return () => {
      active = false;
      clearInterval(poll);
    };
  }, [quoteKey]);

  // Without a live quote, fall back to the last daily close so prices are never blank.
  useEffect(() => {
    if (!quotesAttempted || !quoteKey) return;
    for (const key of quoteKey.split(",")) {
      if (quotes[key]?.quote?.lastPrice != null) continue;
      if (requestedCloses.current.has(key)) continue;
      requestedCloses.current.add(key);
      void apiClient
        .GET("/api/v1/market/instruments/{id}/history", {
          params: { path: { id: key }, query: { range: "1mo" } },
        })
        .then(({ data }) => {
          const bars = data?.bars ?? [];
          const last = bars.at(-1);
          if (!last) return;
          setCloses((current) => ({
            ...current,
            [key]: {
              close: last.close,
              previousClose: bars.at(-2)?.close ?? null,
              at: last.timestamp,
            },
          }));
        })
        .catch(() => undefined);
    }
  }, [quotesAttempted, quoteKey, quotes]);

  useEffect(() => {
    if (auth !== "ready" || !quoteKey) return;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let attempt = 0;
    const endpoint = marketSocketUrl();
    const subscribe = JSON.stringify({
      type: "subscribe",
      modeType: "QUOTE",
      symbols: quoteKey.split(",").map((instrumentKey) => ({ instrumentKey })),
    });
    const connect = () => {
      if (stopped) return;
      ws = new WebSocket(endpoint);
      ws.onopen = () => {
        attempt = 0;
        setSocketConnected(true);
        ws?.send(subscribe);
      };
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type !== "quote") return;
          const quote = quoteFrom(payload.data);
          if (quote)
            setQuotes((current) => ({
              ...current,
              [quote.instrumentKey]: { quote, stale: false },
            }));
        } catch {
          /* ignore malformed event */
        }
      };
      ws.onclose = () => {
        setSocketConnected(false);
        if (!stopped)
          timer = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 15_000));
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      ws?.close();
      setSocketConnected(false);
    };
  }, [auth, quoteKey]);

  const quoteOf = useCallback((key: string) => quotes[key], [quotes]);
  const closeOf = useCallback((key: string) => closes[key], [closes]);
  const priceOf = useCallback(
    (key: string) => priceView(quotes[key], closes[key]),
    [quotes, closes],
  );
  const openTicket = useCallback(
    (instrument: Instrument, side: Side) => {
      remember([instrument]);
      setTicket({ instrument, side });
    },
    [remember],
  );
  const closeTicket = useCallback(() => setTicket(null), []);

  const value: Trader = {
    auth,
    userName,
    userEmail,
    account,
    summary,
    positions,
    orders,
    trades,
    ledger,
    refresh,
    signOut,
    instruments,
    remember,
    watchlist,
    isWatched,
    toggleWatch,
    priceOf,
    quoteOf,
    closeOf,
    trackQuotes,
    socketConnected,
    ticket,
    openTicket,
    closeTicket,
    toasts,
    notify,
    dismiss,
  };
  return (
    <TraderContext.Provider value={value}>{children}</TraderContext.Provider>
  );
}
