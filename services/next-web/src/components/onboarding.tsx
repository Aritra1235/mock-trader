"use client";

import { Check, LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import type { components } from "@/generated/api-schema";
import { apiClient } from "@/lib/api-client";
import { rupees } from "@/lib/format";
import { Logo } from "./auth-screen";
import { ThemeToggle } from "./theme-toggle";
import { useTrader } from "./trader-provider";

type State = components["schemas"]["OnboardingState"];
type StepId = State["steps"][number]["id"];
type Option = components["schemas"]["OnboardingOption"];

/** Full-page setup flow shown until the API reports onboarding complete. */
export function Onboarding() {
  const { refresh, signOut } = useTrader();
  const [state, setState] = useState<State | null>(null);
  const [step, setStep] = useState<StepId>("profile");
  const [loadError, setLoadError] = useState("");
  const [opened, setOpened] = useState<State | null>(null);

  useEffect(() => {
    let active = true;
    void apiClient
      .GET("/api/v1/onboarding")
      .then(({ data, error }) => {
        if (!active) return;
        if (!data) {
          setLoadError(error?.error?.message ?? "Couldn't load your setup.");
          return;
        }
        setState(data);
        setStep(data.currentStep ?? "review");
      })
      .catch(() => active && setLoadError("Can't reach the server."));
    return () => {
      active = false;
    };
  }, []);

  if (opened) return <Opened state={opened} onEnter={() => void refresh()} />;

  const index = state ? state.steps.findIndex((s) => s.id === step) : 0;
  const reachable = (id: StepId) => {
    if (!state) return false;
    const target = state.steps.findIndex((s) => s.id === id);
    // Done steps and the first unfinished one can be visited.
    return state.steps.slice(0, target).every((s) => s.complete);
  };
  const advance = (next: State) => {
    setState(next);
    // Normally move to the following step; if an earlier one is somehow still
    // unfinished, send the user back to it instead.
    const pending = next.steps.findIndex((s) => s.id === next.currentStep);
    const target = pending !== -1 && pending <= index ? pending : index + 1;
    setStep(next.steps[target]?.id ?? "review");
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="setup">
      <header className="setup-top">
        <div className="auth-brand">
          <Logo size={20} />
          <span>Mock Trader</span>
          <span className="setup-tag">Account setup</span>
        </div>
        <div className="setup-top-actions">
          <ThemeToggle />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void signOut()}
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </header>
      {state && (
        <div
          className="setup-progress"
          style={{
            ["--done" as string]: `${(state.steps.filter((s) => s.complete).length / state.steps.length) * 100}%`,
          }}
        />
      )}
      <div className="setup-body">
        <nav className="setup-rail" aria-label="Setup steps">
          <ol>
            {(state?.steps ?? []).map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={`${s.id === step ? "current" : ""} ${s.complete ? "done" : ""}`}
                  disabled={!reachable(s.id)}
                  aria-current={s.id === step ? "step" : undefined}
                  onClick={() => setStep(s.id)}
                >
                  <span className="rail-mark">
                    {s.complete ? <Check size={12} /> : i + 1}
                  </span>
                  <span className="rail-text">
                    <strong>{s.title}</strong>
                    <span>{s.description}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <main className="setup-main">
          {loadError && <div className="auth-msg error">{loadError}</div>}
          {!state && !loadError && <p className="muted">Loading…</p>}
          {state && (
            <StepView
              key={step}
              step={step}
              state={state}
              index={index}
              onSaved={advance}
              onBack={() => setStep(state.steps[index - 1]?.id ?? step)}
              onEdit={setStep}
              onOpened={setOpened}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function StepView({
  step,
  state,
  index,
  onSaved,
  onBack,
  onEdit,
  onOpened,
}: {
  step: StepId;
  state: State;
  index: number;
  onSaved: (state: State) => void;
  onBack: () => void;
  onEdit: (step: StepId) => void;
  onOpened: (state: State) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const meta = state.steps[index];

  const save = async (
    request: () => Promise<{
      data?: State;
      error?: { error?: { message?: string } };
    }>,
    then: (next: State) => void = onSaved,
  ) => {
    setBusy(true);
    setError("");
    try {
      const { data, error: failure } = await request();
      if (!data) {
        setError(failure?.error?.message ?? "Couldn't save. Try again.");
        return;
      }
      then(data);
    } catch {
      setError("Can't reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  };

  const shared = { state, busy, save, onBack, first: index === 0 };
  return (
    <section className="setup-step">
      <p className="setup-count">
        Step {index + 1} of {state.steps.length}
      </p>
      <h1>{meta?.title}</h1>
      <p className="setup-lede">{meta?.description}</p>
      {error && (
        <div className="auth-msg error" role="alert">
          {error}
        </div>
      )}
      {step === "profile" && <ProfileStep {...shared} />}
      {step === "experience" && <ExperienceStep {...shared} />}
      {step === "preferences" && <PreferencesStep {...shared} />}
      {step === "watchlist" && <WatchlistStep {...shared} />}
      {step === "agreements" && <AgreementsStep {...shared} />}
      {step === "review" && (
        <ReviewStep {...shared} onEdit={onEdit} onOpened={onOpened} />
      )}
    </section>
  );
}

type StepProps = {
  state: State;
  busy: boolean;
  first: boolean;
  onBack: () => void;
  save: (
    request: () => Promise<{
      data?: State;
      error?: { error?: { message?: string } };
    }>,
    then?: (next: State) => void,
  ) => Promise<void>;
};

function Footer({
  busy,
  first,
  onBack,
  label = "Save and continue",
  disabled,
}: {
  busy: boolean;
  first: boolean;
  onBack: () => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <footer className="setup-foot">
      {!first ? (
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          Back
        </button>
      ) : (
        <span />
      )}
      <button
        type="submit"
        className="btn btn-primary btn-lg"
        disabled={busy || disabled}
      >
        {busy ? "Saving…" : label}
      </button>
    </footer>
  );
}

function maxBirthDate(minimumAge: number) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - minimumAge);
  return d.toISOString().slice(0, 10);
}

function ProfileStep({ state, busy, first, onBack, save }: StepProps) {
  const { data, options } = state;
  const [form, setForm] = useState({
    fullName: data.fullName,
    dateOfBirth: data.dateOfBirth ?? "",
    phone: data.phone?.replace(/^\+91/, "") ?? "",
    city: data.city ?? "",
    state: data.state ?? "",
    occupation: data.occupation ?? "",
  });
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <form
      className="setup-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save(() =>
          apiClient.POST("/api/v1/onboarding/profile", {
            body: { ...form, phone: form.phone || null },
          }),
        );
      }}
    >
      <div className="form-grid">
        <label className="field span-2">
          <span>Full name</span>
          <input
            value={form.fullName}
            onChange={(e) => set("fullName")(e.target.value)}
            autoComplete="name"
            required
            minLength={2}
            maxLength={80}
          />
          <small>As you'd like it on your account statement.</small>
        </label>
        <label className="field">
          <span>Email</span>
          <input value={data.email} disabled readOnly />
          <small>Verified</small>
        </label>
        <label className="field">
          <span>Mobile number (optional)</span>
          <div className="input-prefix">
            <span>+91</span>
            <input
              value={form.phone}
              onChange={(e) =>
                set("phone")(e.target.value.replace(/\D/g, "").slice(0, 10))
              }
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="98765 43210"
              pattern="[6-9][0-9]{9}"
              title="10-digit Indian mobile number"
            />
          </div>
        </label>
        <label className="field">
          <span>Date of birth</span>
          <input
            type="date"
            value={form.dateOfBirth}
            onChange={(e) => set("dateOfBirth")(e.target.value)}
            max={maxBirthDate(options.minimumAge)}
            min="1910-01-01"
            required
          />
          <small>You must be {options.minimumAge} or older.</small>
        </label>
        <label className="field">
          <span>Occupation</span>
          <select
            value={form.occupation}
            onChange={(e) => set("occupation")(e.target.value)}
            required
          >
            <option value="" disabled>
              Select
            </option>
            {options.occupations.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>City</span>
          <input
            value={form.city}
            onChange={(e) => set("city")(e.target.value)}
            autoComplete="address-level2"
            required
            minLength={2}
            maxLength={60}
          />
        </label>
        <label className="field">
          <span>State / UT</span>
          <select
            value={form.state}
            onChange={(e) => set("state")(e.target.value)}
            required
          >
            <option value="" disabled>
              Select
            </option>
            {options.states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Footer busy={busy} first={first} onBack={onBack} />
    </form>
  );
}

function ChoiceCards({
  name,
  options,
  value,
  onChange,
  columns = 2,
}: {
  name: string;
  options: Option[];
  value: string | null;
  onChange: (value: string) => void;
  columns?: number;
}) {
  return (
    <div
      className="choice-cards"
      role="radiogroup"
      aria-label={name}
      style={{ ["--cols" as string]: columns }}
    >
      {options.map((o) => (
        <label key={o.value} className={value === o.value ? "on" : ""}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          <strong>{o.label}</strong>
          {o.description && <span>{o.description}</span>}
        </label>
      ))}
    </div>
  );
}

function Chips({
  label,
  options,
  values,
  onChange,
}: {
  label: string;
  options: Option[];
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <fieldset className="chips" aria-label={label}>
      {options.map((o) => {
        const on = values.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            className={on ? "on" : ""}
            onClick={() =>
              onChange(
                on ? values.filter((v) => v !== o.value) : [...values, o.value],
              )
            }
          >
            {on && <Check size={12} />}
            {o.label}
          </button>
        );
      })}
    </fieldset>
  );
}

function ExperienceStep({ state, busy, first, onBack, save }: StepProps) {
  const { data, options } = state;
  const [level, setLevel] = useState(data.experienceLevel);
  const [traded, setTraded] = useState<string[]>(data.instrumentsTraded);
  const [style, setStyle] = useState(data.tradingStyle);
  const isNew = level === "none";
  const ready = Boolean(level && style && (isNew || traded.length > 0));

  return (
    <form
      className="setup-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!level || !style) return;
        void save(() =>
          apiClient.POST("/api/v1/onboarding/experience", {
            body: {
              experienceLevel: level,
              instrumentsTraded: isNew ? [] : traded,
              tradingStyle: style,
            },
          }),
        );
      }}
    >
      <Question title="How much trading experience do you have?">
        <ChoiceCards
          name="experience"
          options={options.experienceLevels}
          value={level}
          onChange={setLevel}
          columns={4}
        />
      </Question>
      {level && !isNew && (
        <Question
          title="What have you traded before?"
          hint="Select all that apply."
        >
          <Chips
            label="Instruments traded"
            options={options.instruments}
            values={traded}
            onChange={setTraded}
          />
        </Question>
      )}
      <Question title="How do you plan to trade here?">
        <ChoiceCards
          name="style"
          options={options.tradingStyles}
          value={style}
          onChange={setStyle}
          columns={4}
        />
      </Question>
      <Footer busy={busy} first={first} onBack={onBack} disabled={!ready} />
    </form>
  );
}

function PreferencesStep({ state, busy, first, onBack, save }: StepProps) {
  const { data, options } = state;
  const [goals, setGoals] = useState<string[]>(data.tradingGoals);
  const [risk, setRisk] = useState(data.riskAppetite);
  const [capital, setCapital] = useState<number | null>(
    data.startingCapital ?? 1_000_000,
  );
  const ready = goals.length > 0 && Boolean(risk) && capital !== null;

  return (
    <form
      className="setup-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!risk || capital === null) return;
        void save(() =>
          apiClient.POST("/api/v1/onboarding/preferences", {
            body: {
              tradingGoals: goals,
              riskAppetite: risk,
              startingCapital: capital,
            },
          }),
        );
      }}
    >
      <Question
        title="What do you want to get out of Mock Trader?"
        hint="Pick one or more."
      >
        <Chips
          label="Goals"
          options={options.goals}
          values={goals}
          onChange={setGoals}
        />
      </Question>
      <Question title="How would you describe your risk appetite?">
        <ChoiceCards
          name="risk"
          options={options.riskAppetites}
          value={risk}
          onChange={setRisk}
          columns={3}
        />
      </Question>
      {state.existingAccount ? (
        <Question title="Starting virtual capital">
          <p className="setup-note">
            You already have practice account{" "}
            <strong>{state.existingAccount.accountNumber}</strong>, opened with{" "}
            {rupees(state.existingAccount.startingBalance)}. It keeps its
            balance, positions and history.
          </p>
        </Question>
      ) : (
        <Question
          title="Starting virtual capital"
          hint="Credited to your practice account when it opens. It can't be changed later."
        >
          <div
            className="choice-cards capital"
            role="radiogroup"
            aria-label="Starting capital"
            style={{ ["--cols" as string]: 4 }}
          >
            {options.startingCapitals.map((o) => (
              <label key={o.value} className={capital === o.value ? "on" : ""}>
                <input
                  type="radio"
                  name="capital"
                  checked={capital === o.value}
                  onChange={() => setCapital(o.value)}
                />
                <strong>{o.label}</strong>
                <span className="num">{rupees(o.value)}</span>
              </label>
            ))}
          </div>
        </Question>
      )}
      <Footer busy={busy} first={first} onBack={onBack} disabled={!ready} />
    </form>
  );
}

function WatchlistStep({ state, busy, first, onBack, save }: StepProps) {
  const { data, options } = state;
  const [picked, setPicked] = useState<string[]>(
    data.watchlist.map((i) => i.instrumentKey),
  );
  const toggle = (key: string) =>
    setPicked((current) =>
      current.includes(key)
        ? current.filter((k) => k !== key)
        : current.length >= options.maxWatchlist
          ? current
          : [...current, key],
    );

  return (
    <form
      className="setup-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save(() =>
          apiClient.POST("/api/v1/onboarding/watchlist", {
            body: { instrumentIds: picked },
          }),
        );
      }}
    >
      <Question
        title="Follow a few stocks to start"
        hint={`Pick at least one. You can search all NSE and BSE instruments once your account is open. ${picked.length} / ${options.maxWatchlist} selected.`}
      >
        <div className="pick-grid">
          {options.suggestedInstruments.map((item) => {
            const on = picked.includes(item.instrumentKey);
            return (
              <button
                key={item.instrumentKey}
                type="button"
                aria-pressed={on}
                className={on ? "on" : ""}
                onClick={() => toggle(item.instrumentKey)}
              >
                <span className="pick-check">{on && <Check size={12} />}</span>
                <span className="pick-text">
                  <strong>{item.symbol}</strong>
                  <span>{item.name}</span>
                </span>
                <span className="exch">{item.exchange}</span>
              </button>
            );
          })}
        </div>
      </Question>
      <Footer
        busy={busy}
        first={first}
        onBack={onBack}
        disabled={picked.length === 0}
      />
    </form>
  );
}

function AgreementsStep({ state, busy, first, onBack, save }: StepProps) {
  const { options, data } = state;
  const accepted = data.termsVersion === options.terms.version;
  const [terms, setTerms] = useState(accepted);
  const [risk, setRisk] = useState(accepted);
  const [termsSection, riskSection] = options.terms.sections;

  return (
    <form
      className="setup-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save(() =>
          apiClient.POST("/api/v1/onboarding/agreements", {
            body: {
              termsVersion: options.terms.version,
              acceptTerms: true,
              acceptRiskDisclosure: true,
            },
          }),
        );
      }}
    >
      {[
        { section: termsSection, checked: terms, set: setTerms },
        { section: riskSection, checked: risk, set: setRisk },
      ].map(
        ({ section, checked, set }) =>
          section && (
            <div key={section.id} className="terms-block">
              <h2>{section.title}</h2>
              <ul>
                {section.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              <label className="check">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => set(e.target.checked)}
                />
                <span>
                  I have read and accept the {section.title.toLowerCase()}.
                </span>
              </label>
            </div>
          ),
      )}
      <p className="muted small">Version {options.terms.version}</p>
      <Footer
        busy={busy}
        first={first}
        onBack={onBack}
        label="Accept and continue"
        disabled={!terms || !risk}
      />
    </form>
  );
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)).toLocaleDateString(
    "en-IN",
    { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" },
  );
}

function labelOf(list: Option[], value: string | null) {
  return list.find((o) => o.value === value)?.label ?? "—";
}

function ReviewStep({
  state,
  busy,
  first,
  onBack,
  save,
  onEdit,
  onOpened,
}: StepProps & {
  onEdit: (step: StepId) => void;
  onOpened: (state: State) => void;
}) {
  const { data, options } = state;
  const capital = options.startingCapitals.find(
    (o) => o.value === data.startingCapital,
  );
  // The React Compiler memoises this; no useMemo needed.
  const sections = [
    {
      step: "profile" as const,
      title: "Personal details",
      rows: [
        ["Name", data.fullName],
        ["Email", data.email],
        ["Date of birth", formatDate(data.dateOfBirth)],
        [
          "Mobile",
          data.phone
            ? data.phone.replace(/^\+91(\d{5})(\d{5})$/, "+91 $1 $2")
            : "Not provided",
        ],
        ["Location", [data.city, data.state].filter(Boolean).join(", ")],
        ["Occupation", labelOf(options.occupations, data.occupation)],
      ],
    },
    {
      step: "experience" as const,
      title: "Trading experience",
      rows: [
        ["Experience", labelOf(options.experienceLevels, data.experienceLevel)],
        [
          "Traded before",
          data.instrumentsTraded.length
            ? data.instrumentsTraded
                .map((v) => labelOf(options.instruments, v))
                .join(", ")
            : "None",
        ],
        ["Style", labelOf(options.tradingStyles, data.tradingStyle)],
      ],
    },
    {
      step: "preferences" as const,
      title: "Goals & capital",
      rows: [
        [
          "Goals",
          data.tradingGoals.map((v) => labelOf(options.goals, v)).join(", "),
        ],
        ["Risk appetite", labelOf(options.riskAppetites, data.riskAppetite)],
        [
          "Starting capital",
          state.existingAccount
            ? `Existing account ${state.existingAccount.accountNumber}`
            : rupees(data.startingCapital),
        ],
      ],
    },
    {
      step: "watchlist" as const,
      title: "First watchlist",
      rows: [["Stocks", data.watchlist.map((i) => i.symbol).join(", ")]],
    },
  ] satisfies { step: StepId; title: string; rows: string[][] }[];

  return (
    <form
      className="setup-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save(
          () => apiClient.POST("/api/v1/onboarding/complete"),
          onOpened,
        );
      }}
    >
      {sections.map((section) => (
        <div key={section.step} className="review-block">
          <div className="review-head">
            <h2>{section.title}</h2>
            <button
              type="button"
              className="link small"
              onClick={() => onEdit(section.step)}
            >
              Edit
            </button>
          </div>
          <dl>
            {section.rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      <div className="review-open">
        <div>
          <strong>Practice account · INR</strong>
          <span>
            {state.existingAccount
              ? `Your existing account ${state.existingAccount.accountNumber} is kept as it is.`
              : `Opens with ${capital?.label ?? rupees(data.startingCapital)} of virtual cash.`}{" "}
            Terms accepted{" "}
            {data.termsAcceptedAt
              ? new Date(data.termsAcceptedAt).toLocaleDateString("en-IN")
              : ""}
            .
          </span>
        </div>
      </div>
      <Footer
        busy={busy}
        first={first}
        onBack={onBack}
        label={
          state.existingAccount ? "Finish setup" : "Open my practice account"
        }
      />
    </form>
  );
}

function Question({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="question">
      <h2>{title}</h2>
      {hint && <p className="muted small">{hint}</p>}
      {children}
    </div>
  );
}

function Opened({ state, onEnter }: { state: State; onEnter: () => void }) {
  return (
    <div className="setup setup-done">
      <div className="done-panel">
        <span className="done-mark">
          <Check size={22} />
        </span>
        <h1>
          {state.existingAccount
            ? "You're all set"
            : "Your practice account is open"}
        </h1>
        <p>
          {state.existingAccount
            ? `Account ${state.existingAccount.accountNumber} is ready.`
            : `${rupees(state.data.startingCapital)} in virtual cash is ready to trade.`}{" "}
          Your watchlist has {state.data.watchlist.length}{" "}
          {state.data.watchlist.length === 1 ? "stock" : "stocks"} to start
          with.
        </p>
        <ul className="done-tips">
          <li>
            Press <kbd>/</kbd> anywhere to search instruments.
          </li>
          <li>
            Hover a watchlist row and click <b>B</b> or <b>S</b> to place an
            order.
          </li>
          <li>Sell more than you hold to open a short position.</li>
        </ul>
        <button
          type="button"
          className="btn btn-primary btn-lg"
          onClick={onEnter}
        >
          Go to dashboard
        </button>
      </div>
    </div>
  );
}
