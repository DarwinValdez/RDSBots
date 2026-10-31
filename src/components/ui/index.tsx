import clsx from "clsx";
import { AlertTriangle, Database } from "lucide-react";
import type { ReactNode } from "react";

export function Card({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx("rounded-xl border border-line bg-surface", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold tracking-wide text-ink">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "good" | "bad" | "neutral" }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div
        className={clsx(
          "tabular mt-1 text-2xl font-semibold",
          tone === "good" ? "text-brand" : tone === "bad" ? "text-bad" : "text-ink",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

const BADGE = {
  green: "bg-brand/10 text-brand ring-brand/30",
  blue: "bg-info/10 text-info ring-info/30",
  amber: "bg-warn/10 text-warn ring-warn/30",
  red: "bg-bad/10 text-bad ring-bad/30",
  gray: "bg-surface-3 text-ink-2 ring-line",
};

export function Badge({ tone = "gray", children }: { tone?: keyof typeof BADGE; children: ReactNode }) {
  return <span className={clsx("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset", BADGE[tone])}>{children}</span>;
}

export function ConfidenceBadge({ level }: { level: string }) {
  const tone = level === "high" ? "green" : level === "medium" ? "blue" : "amber";
  const label = level === "high" ? "Confianza alta" : level === "medium" ? "Confianza media" : "Confianza baja";
  return <Badge tone={tone}>{label}</Badge>;
}

export function DataUnavailable({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed border-line bg-surface-2/50 p-4 text-sm">
      <Database className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
      <div>
        <div className="font-medium text-ink-2">{title}</div>
        {children && <div className="mt-1 text-muted">{children}</div>}
      </div>
    </div>
  );
}

export function Notice({ tone = "amber", children }: { tone?: "amber" | "red" | "blue"; children: ReactNode }) {
  const cls = tone === "red" ? "border-bad/40 bg-bad/5" : tone === "blue" ? "border-info/40 bg-info/5" : "border-warn/40 bg-warn/5";
  return (
    <div className={clsx("flex items-start gap-2 rounded-lg border p-3 text-sm text-ink-2", cls)}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
      <div>{children}</div>
    </div>
  );
}

/** Horizontal probability bar: estimated vs implied. */
export function ProbBar({ estimated, implied }: { estimated: number; implied: number | null }) {
  return (
    <div className="relative h-1.5 w-full rounded-full bg-surface-3" aria-hidden>
      <div className="absolute inset-y-0 left-0 rounded-full bg-chart-1" style={{ width: `${Math.min(100, estimated * 100)}%` }} />
      {implied != null && <div className="absolute -top-0.5 h-2.5 w-0.5 bg-ink" style={{ left: `${Math.min(100, implied * 100)}%` }} />}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold text-ink md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">{children}</table>
    </div>
  );
}

export const th = "border-b border-line px-3 py-2 text-xs font-medium uppercase tracking-wider text-muted";
export const td = "border-b border-line/60 px-3 py-2.5 align-middle";
