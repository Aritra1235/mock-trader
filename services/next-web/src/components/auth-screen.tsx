"use client";

import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiBase } from "@/lib/endpoints";
import { obj, str } from "@/lib/market";
import { ThemeToggle } from "./theme-toggle";

type Mode = "signin" | "signup" | "verify" | "forgot" | "reset";
type Message = { tone: "error" | "success"; text: string } | null;

const RESEND_SECONDS = 60;

async function post(path: string, body: unknown) {
  const response = await fetch(`${apiBase}/api/v1/auth${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = obj(await response.json().catch(() => ({})));
  return {
    ok: response.ok,
    status: response.status,
    code: str(data.code),
    message: str(data.message),
    data,
  };
}

const passwordRules = [
  { test: (p: string) => p.length >= 8, label: "At least 8 characters" },
  { test: (p: string) => /[A-Za-z]/.test(p), label: "A letter" },
  { test: (p: string) => /\d/.test(p), label: "A number" },
];

export function AuthScreen({
  state,
  onSuccess,
}: {
  state: "unauthorized" | "verify";
  onSuccess: () => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<Message>(
    state === "verify"
      ? { tone: "error", text: "Verify your email to continue." }
      : null,
  );
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const go = (next: Mode, note: Message = null) => {
    setMode(next);
    setMessage(note);
    setCode("");
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch {
      setMessage({
        tone: "error",
        text: "Can't reach the server. Check your connection and try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async () => {
    const result = await post("/email-otp/send-verification-otp", {
      email,
      type: "email-verification",
    });
    if (!result.ok) {
      setMessage({
        tone: "error",
        text: result.message || "Couldn't send a code. Try again shortly.",
      });
      return false;
    }
    setCooldown(RESEND_SECONDS);
    return true;
  };

  const signIn = () =>
    run(async () => {
      const result = await post("/sign-in/email", { email, password });
      if (result.ok) return onSuccess();
      if (result.code === "EMAIL_NOT_VERIFIED" || result.status === 403) {
        if (await sendCode()) {
          go("verify", {
            tone: "success",
            text: `Your email isn't verified yet. We sent a new code to ${email}.`,
          });
        }
        return;
      }
      setMessage({
        tone: "error",
        text:
          result.code === "INVALID_EMAIL_OR_PASSWORD"
            ? "That email and password don't match."
            : result.message || "Couldn't sign you in. Try again.",
      });
    });

  const signUp = () =>
    run(async () => {
      if (!passwordRules.every((rule) => rule.test(password))) {
        setMessage({
          tone: "error",
          text: "Choose a password that meets every requirement.",
        });
        return;
      }
      const result = await post("/sign-up/email", {
        name: name.trim(),
        email,
        password,
      });
      if (!result.ok) {
        setMessage({
          tone: "error",
          text:
            result.code === "USER_ALREADY_EXISTS" ||
            result.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"
              ? "An account with this email already exists. Sign in instead."
              : result.message || "Couldn't create your account.",
        });
        return;
      }
      // Sign-up sends the first verification code automatically.
      setCooldown(RESEND_SECONDS);
      go("verify", {
        tone: "success",
        text: `We sent a 6-digit code to ${email}.`,
      });
    });

  const verify = (otp: string) =>
    run(async () => {
      const result = await post("/email-otp/verify-email", { email, otp });
      if (!result.ok) {
        setCode("");
        setMessage({
          tone: "error",
          text:
            result.code === "TOO_MANY_ATTEMPTS"
              ? "Too many attempts. Send a new code."
              : result.code === "OTP_EXPIRED"
                ? "That code has expired. Send a new one."
                : "That code isn't right. Check the email and try again.",
        });
        return;
      }
      // Verifying signs the user in; the app moves on to onboarding.
      await onSuccess();
    });

  const requestReset = () =>
    run(async () => {
      const result = await post("/email-otp/request-password-reset", {
        email,
      });
      if (!result.ok) {
        setMessage({
          tone: "error",
          text: result.message || "Couldn't send a reset code.",
        });
        return;
      }
      setCooldown(RESEND_SECONDS);
      setPassword("");
      go("reset", {
        tone: "success",
        text: `If an account exists for ${email}, we sent it a 6-digit code.`,
      });
    });

  const resetPassword = () =>
    run(async () => {
      if (!passwordRules.every((rule) => rule.test(password))) {
        setMessage({
          tone: "error",
          text: "Choose a password that meets every requirement.",
        });
        return;
      }
      const result = await post("/email-otp/reset-password", {
        email,
        otp: code,
        password,
      });
      if (!result.ok) {
        setMessage({
          tone: "error",
          text:
            result.code === "INVALID_OTP" || result.code === "OTP_EXPIRED"
              ? "That code isn't valid any more. Request a new one."
              : result.message || "Couldn't reset your password.",
        });
        return;
      }
      setPassword("");
      go("signin", {
        tone: "success",
        text: "Password updated. Sign in with your new password.",
      });
    });

  const google = () =>
    run(async () => {
      const result = await post("/sign-in/social", {
        provider: "google",
        callbackURL: window.location.origin,
        disableRedirect: true,
      });
      const url = str(result.data.url);
      if (!result.ok || !url) {
        setMessage({
          tone: "error",
          text: result.message || "Google sign-in is unavailable right now.",
        });
        return;
      }
      window.location.assign(url);
    });

  const heading: Record<Mode, [string, string]> = {
    signin: ["Sign in", "Welcome back. Pick up where you left off."],
    signup: [
      "Create your account",
      "Free practice account with up to ₹25 lakh in virtual capital.",
    ],
    verify: ["Verify your email", `Enter the 6-digit code sent to ${email}.`],
    forgot: [
      "Reset your password",
      "We'll email you a code to set a new password.",
    ],
    reset: ["Set a new password", `Enter the code sent to ${email}.`],
  };

  return (
    <div className="auth-layout">
      <aside className="auth-aside">
        <div className="auth-brand">
          <Logo size={22} />
          <span>Mock Trader</span>
        </div>
        <div className="auth-pitch">
          <h2>Practise trading Indian markets without risking a rupee.</h2>
          <p>
            Live NSE and BSE prices, real order mechanics and a full portfolio,
            all on virtual money.
          </p>
        </div>
        <ol className="auth-steps">
          <li>
            <strong>Create your account</strong>
            <span>Email and password, or Google.</span>
          </li>
          <li>
            <strong>Verify your email</strong>
            <span>A 6-digit code, valid for 10 minutes.</span>
          </li>
          <li>
            <strong>Set up your profile</strong>
            <span>Experience, goals, capital and a first watchlist.</span>
          </li>
          <li>
            <strong>Start trading</strong>
            <span>Buy, sell and short with your virtual balance.</span>
          </li>
        </ol>
        <p className="auth-legal">
          No real orders are ever sent to an exchange or broker.
        </p>
      </aside>

      <main className="auth-main">
        <ThemeToggle className="auth-theme" />
        <div className="auth-panel">
          <div className="auth-brand auth-brand-mobile">
            <Logo size={20} />
            <span>Mock Trader</span>
          </div>
          {(mode === "verify" || mode === "forgot" || mode === "reset") && (
            <button
              type="button"
              className="auth-back"
              onClick={() => go("signin")}
            >
              <ArrowLeft size={14} /> Back to sign in
            </button>
          )}
          <h1>{heading[mode][0]}</h1>
          <p className="auth-sub">{heading[mode][1]}</p>

          {message && (
            <div
              className={`auth-msg ${message.tone}`}
              role={message.tone === "error" ? "alert" : "status"}
            >
              {message.text}
            </div>
          )}

          {(mode === "signin" || mode === "signup") && (
            <>
              <form
                className="auth-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void (mode === "signin" ? signIn() : signUp());
                }}
              >
                {mode === "signup" && (
                  <label className="field">
                    <span>Full name</span>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="name"
                      minLength={2}
                      maxLength={80}
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
                    onChange={(e) => setEmail(e.target.value.trim())}
                    required
                  />
                </label>
                <PasswordField
                  label="Password"
                  value={password}
                  onChange={setPassword}
                  autoComplete={
                    mode === "signin" ? "current-password" : "new-password"
                  }
                  aside={
                    mode === "signin" ? (
                      <button
                        type="button"
                        className="link small"
                        onClick={() => go("forgot")}
                      >
                        Forgot password?
                      </button>
                    ) : null
                  }
                />
                {mode === "signup" && <PasswordRules password={password} />}
                <button
                  className="btn btn-primary btn-block"
                  type="submit"
                  disabled={busy}
                >
                  {busy
                    ? "Please wait…"
                    : mode === "signin"
                      ? "Sign in"
                      : "Create account"}
                </button>
                {mode === "signup" && (
                  <p className="auth-fine">
                    You'll review the terms of use and risk disclosure before
                    your account opens.
                  </p>
                )}
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
                <GoogleIcon />
                Continue with Google
              </button>
              <p className="auth-switch">
                {mode === "signin"
                  ? "New to Mock Trader? "
                  : "Already have an account? "}
                <button
                  type="button"
                  className="link"
                  onClick={() => go(mode === "signin" ? "signup" : "signin")}
                >
                  {mode === "signin" ? "Create an account" : "Sign in"}
                </button>
              </p>
            </>
          )}

          {mode === "verify" && (
            <div className="auth-form">
              <CodeInput
                value={code}
                onChange={setCode}
                onComplete={(otp) => void verify(otp)}
                disabled={busy}
              />
              <button
                type="button"
                className="btn btn-primary btn-block"
                disabled={busy || code.length !== 6}
                onClick={() => void verify(code)}
              >
                {busy ? "Verifying…" : "Verify and continue"}
              </button>
              <p className="auth-fine">
                Didn't get it? Check spam, or{" "}
                <button
                  type="button"
                  className="link"
                  disabled={cooldown > 0 || busy}
                  onClick={() =>
                    void run(async () => {
                      if (await sendCode())
                        setMessage({
                          tone: "success",
                          text: `New code sent to ${email}.`,
                        });
                    })
                  }
                >
                  {cooldown > 0 ? `resend in ${cooldown}s` : "send a new code"}
                </button>
                .
              </p>
            </div>
          )}

          {mode === "forgot" && (
            <form
              className="auth-form"
              onSubmit={(e) => {
                e.preventDefault();
                void requestReset();
              }}
            >
              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value.trim())}
                  required
                />
              </label>
              <button
                className="btn btn-primary btn-block"
                type="submit"
                disabled={busy}
              >
                {busy ? "Sending…" : "Send reset code"}
              </button>
            </form>
          )}

          {mode === "reset" && (
            <form
              className="auth-form"
              onSubmit={(e) => {
                e.preventDefault();
                void resetPassword();
              }}
            >
              <CodeInput value={code} onChange={setCode} disabled={busy} />
              <PasswordField
                label="New password"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
              />
              <PasswordRules password={password} />
              <button
                className="btn btn-primary btn-block"
                type="submit"
                disabled={busy || code.length !== 6}
              >
                {busy ? "Saving…" : "Update password"}
              </button>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  aside,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  aside?: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="field">
      <span className="field-label-row">
        <label htmlFor={`pw-${label}`}>{label}</label>
        {aside}
      </span>
      <div className="input-affix">
        <input
          id={`pw-${label}`}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          minLength={8}
          maxLength={128}
          required
        />
        <button
          type="button"
          className="icon-button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
        >
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </div>
  );
}

function PasswordRules({ password }: { password: string }) {
  return (
    <ul className="pw-rules">
      {passwordRules.map((rule) => (
        <li key={rule.label} className={rule.test(password) ? "met" : ""}>
          {rule.label}
        </li>
      ))}
    </ul>
  );
}

/** Six single-digit boxes that behave like one field (typing, paste, backspace). */
function CodeInput({
  value,
  onChange,
  onComplete,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
}) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => {
    boxes.current[0]?.focus();
  }, []);

  const set = (next: string) => {
    const digits = next.replace(/\D/g, "").slice(0, 6);
    onChange(digits);
    boxes.current[Math.min(digits.length, 5)]?.focus();
    if (digits.length === 6) onComplete?.(digits);
  };

  return (
    <fieldset className="code-input" aria-label="6-digit code">
      {Array.from({ length: 6 }, (_, i) => (
        <input
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed positions
          key={i}
          ref={(el) => {
            boxes.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${i + 1}`}
          maxLength={6}
          value={value[i] ?? ""}
          disabled={disabled}
          onChange={(e) => {
            const typed = e.target.value.replace(/\D/g, "");
            if (!typed) return;
            set(value.slice(0, i) + typed + value.slice(i + typed.length));
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace") {
              e.preventDefault();
              const at = value[i] ? i : i - 1;
              if (at < 0) return;
              onChange(value.slice(0, at));
              boxes.current[at]?.focus();
            } else if (e.key === "ArrowLeft") boxes.current[i - 1]?.focus();
            else if (e.key === "ArrowRight") boxes.current[i + 1]?.focus();
          }}
          onPaste={(e) => {
            e.preventDefault();
            set(e.clipboardData.getData("text"));
          }}
        />
      ))}
    </fieldset>
  );
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        d="M3 18 9 8l4 6 3-4 5 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function GoogleIcon() {
  return (
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
  );
}
