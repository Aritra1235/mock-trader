"use client";

import { useState } from "react";
import { apiBase } from "@/lib/endpoints";
import { obj, str } from "@/lib/market";
import { ThemeToggle } from "./theme-toggle";

export function AuthScreen({
  state,
  onSuccess,
}: {
  state: "unauthorized" | "verify";
  onSuccess: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<{
    tone: "error" | "success";
    text: string;
  } | null>(
    state === "verify"
      ? {
          tone: "success",
          text: "Verify your email from the link in your inbox, then log in to open your practice account.",
        }
      : null,
  );
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const endpoint =
        mode === "signin"
          ? "/api/v1/auth/sign-in/email"
          : "/api/v1/auth/sign-up/email";
      const response = await fetch(`${apiBase}${endpoint}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "signin" ? { email, password } : { name, email, password },
        ),
      });
      const data = obj(await response.json().catch(() => ({})));
      if (!response.ok) {
        setMessage({
          tone: "error",
          text: str(data.message) || "Check your details and try again.",
        });
        return;
      }
      if (mode === "signup") {
        setMessage({
          tone: "success",
          text: "Account created. Verify your email from the link we sent, then log in.",
        });
        setMode("signin");
        setPassword("");
        return;
      }
      await onSuccess();
    } catch {
      setMessage({ tone: "error", text: "Unable to reach the login service." });
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${apiBase}/api/v1/auth/sign-in/social`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "google",
          callbackURL: window.location.origin,
          disableRedirect: true,
        }),
      });
      const data = obj(await response.json());
      if (!response.ok || !str(data.url))
        throw new Error(str(data.message) || "Google login is unavailable.");
      window.location.assign(str(data.url));
    } catch (cause) {
      setMessage({
        tone: "error",
        text:
          cause instanceof Error
            ? cause.message
            : "Google login is unavailable.",
      });
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <ThemeToggle className="auth-theme" />
      <div className="auth-box">
        <div className="auth-logo">
          <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
            <path
              d="M3 18 9 8l4 6 3-4 5 8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <h1>
          {mode === "signin"
            ? "Login to Mock Trader"
            : "Open a practice account"}
        </h1>
        <form onSubmit={(e) => void submit(e)} className="auth-form">
          {mode === "signup" && (
            <label className="field">
              <span>Full name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required
              />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>
          {message && (
            <div
              className={`auth-msg ${message.tone}`}
              role={message.tone === "error" ? "alert" : "status"}
            >
              {message.text}
            </div>
          )}
          <button
            className="btn btn-primary btn-block"
            type="submit"
            disabled={busy}
          >
            {busy ? "Please wait…" : mode === "signin" ? "Login" : "Sign up"}
          </button>
        </form>
        <div className="auth-or">
          <span>or</span>
        </div>
        <button
          className="btn btn-ghost btn-block"
          type="button"
          disabled={busy}
          onClick={() => void google()}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M22.5 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2-1.9 3.2-4.7 3.2-7.9Z"
            />
            <path
              fill="#34A853"
              d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23Z"
            />
            <path
              fill="#FBBC05"
              d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8l3.7-2.8Z"
            />
            <path
              fill="#EA4335"
              d="M12 5.4c1.6 0 3 .6 4.2 1.6l3.1-3.1A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4Z"
            />
          </svg>
          Continue with Google
        </button>
        <p className="auth-switch">
          {mode === "signin"
            ? "Don't have an account? "
            : "Already have an account? "}
          <button
            type="button"
            className="link"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setMessage(null);
            }}
          >
            {mode === "signin" ? "Sign up for free" : "Login"}
          </button>
        </p>
      </div>
      <p className="auth-foot">
        Practice trading with virtual money on live NSE and BSE prices. No real
        orders are sent to any exchange.
      </p>
    </div>
  );
}
