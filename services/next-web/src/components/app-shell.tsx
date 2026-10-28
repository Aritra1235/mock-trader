"use client";

import { ChevronDown, List, LogOut, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { marketSession } from "@/lib/market";
import { AuthScreen } from "./auth-screen";
import { OrderWindow } from "./order-window";
import { ThemeToggle } from "./theme-toggle";
import { useTrader } from "./trader-provider";
import { Watchlist } from "./watchlist";

const nav = [
  { href: "/", label: "Dashboard" },
  { href: "/markets", label: "Markets" },
  { href: "/portfolio", label: "Holdings" },
  { href: "/activity", label: "Orders" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const trader = useTrader();
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: close the drawer on navigation
  useEffect(() => setDrawer(false), [pathname]);

  if (trader.auth === "unauthorized" || trader.auth === "verify")
    return <AuthScreen state={trader.auth} onSuccess={trader.refresh} />;

  const active = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <div className="terminal">
      <header className="topbar">
        <div className="topbar-left">
          <button
            type="button"
            className="icon-button drawer-toggle"
            onClick={() => setDrawer((x) => !x)}
            aria-label={drawer ? "Close watchlist" : "Open watchlist"}
          >
            {drawer ? <X size={18} /> : <List size={18} />}
          </button>
          <Link href="/" className="logo" aria-label="Mock Trader home">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path
                d="M3 18 9 8l4 6 3-4 5 8"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
            <span>Mock Trader</span>
          </Link>
          <MarketStatus />
        </div>
        <nav className="topnav" aria-label="Primary">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={active(item.href) ? "active" : ""}
              aria-current={active(item.href) ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <ThemeToggle className="topbar-theme" />
        <UserMenu />
      </header>
      {trader.auth === "offline" && (
        <div className="banner banner-error">
          Cannot reach the trading API. Start the backend and reload to see your
          account and prices.
        </div>
      )}
      <div className="workspace">
        <aside className={`watchlist-panel ${drawer ? "open" : ""}`}>
          <Watchlist />
        </aside>
        <main className="content">{children}</main>
      </div>
      <nav className="mobile-nav" aria-label="Primary">
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={active(item.href) ? "active" : ""}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <OrderWindow />
      <Toasts />
    </div>
  );
}

function MarketStatus() {
  const { socketConnected, auth } = useTrader();
  const [session, setSession] = useState<"open" | "closed" | null>(null);
  useEffect(() => {
    const tick = () => setSession(marketSession());
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);
  if (!session) return null;
  return (
    <div className="market-status">
      <span className={`dot ${session === "open" ? "dot-open" : ""}`} />
      <span>NSE {session === "open" ? "open" : "closed"}</span>
      <span className="sep" />
      <span className={socketConnected ? "" : "muted"}>
        {auth !== "ready"
          ? "Feed offline"
          : socketConnected
            ? "Live feed"
            : "Feed reconnecting"}
      </span>
    </div>
  );
}

function UserMenu() {
  const { auth, userName, userEmail, account, signOut } = useTrader();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);
  if (auth !== "ready") return <div className="user-menu" />;
  const label = userName || userEmail;
  const initials = label
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0]?.toUpperCase())
    .join("");
  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="user-button"
        onClick={() => setOpen((x) => !x)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="avatar">{initials || "?"}</span>
        <span className="user-id">{account?.accountNumber ?? "Account"}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            <strong>{userName || "Trader"}</strong>
            <span>{userEmail}</span>
          </div>
          <div className="menu-row">
            <span>Account</span>
            <span className="num">{account?.accountNumber ?? "—"}</span>
          </div>
          <div className="menu-row">
            <span>Type</span>
            <span>Practice · INR</span>
          </div>
          <Link
            href="/activity?tab=funds"
            className="menu-item"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            Funds ledger
          </Link>
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={() => void signOut()}
          >
            <LogOut size={14} /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

function Toasts() {
  const { toasts, dismiss } = useTrader();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          <div>
            <strong>{t.title}</strong>
            {t.body && <p>{t.body}</p>}
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
