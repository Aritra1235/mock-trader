import Link from "next/link";
import { titleCase } from "@/lib/format";
import { type Instrument, instrumentHref, keyLabel } from "@/lib/market";

export function PageHeader({
  title,
  meta,
  actions,
}: {
  title: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {meta && <div className="page-meta">{meta}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Empty({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function SideTag({ side }: { side: string }) {
  return (
    <span className={`tag ${side === "buy" ? "tag-buy" : "tag-sell"}`}>
      {side.toUpperCase()}
    </span>
  );
}

const statusTone: Record<string, string> = {
  filled: "tag-ok",
  complete: "tag-ok",
  posted: "tag-ok",
  rejected: "tag-bad",
  canceled: "tag-muted",
  queued: "tag-warn",
  pending: "tag-warn",
};

export function StatusTag({ status }: { status: string }) {
  const label = status === "filled" ? "complete" : status;
  return (
    <span className={`tag ${statusTone[status] ?? "tag-muted"}`}>
      {label.toUpperCase()}
    </span>
  );
}

export function InstrumentCell({
  instrumentKey,
  instrument,
}: {
  instrumentKey: string;
  instrument?: Instrument;
}) {
  return (
    <Link href={instrumentHref(instrumentKey)} className="cell-instrument">
      {instrument?.symbol ?? keyLabel(instrumentKey)}
      {instrument && <span className="exch">{instrument.exchange}</span>}
    </Link>
  );
}

export function ledgerLabel(type: string, description?: string | null) {
  return description || titleCase(type);
}
