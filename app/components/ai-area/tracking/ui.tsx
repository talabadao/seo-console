"use client";

import type { ReactNode } from "react";

export const inputStyle: React.CSSProperties = {
  background: "var(--page-plane)",
  color: "var(--text-primary)",
  borderColor: "var(--border-hairline)",
};

export function Panel({
  icon,
  title,
  subtitle,
  actions,
  footer,
  children,
  className,
  bodyClassName,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: string;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={`flex min-w-0 flex-col overflow-hidden rounded-xl border ${className ?? ""}`}
      style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
    >
      <header
        className="flex min-h-12 items-center justify-between gap-3 border-b px-4 py-2.5"
        style={{ borderColor: "var(--border-hairline)" }}
      >
        <div className="flex min-w-0 items-center gap-2">
          {icon ? (
            <span className="shrink-0" style={{ color: "var(--text-secondary)" }}>
              {icon}
            </span>
          ) : null}
          <h3 className="shrink-0 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {title}
          </h3>
          {subtitle ? (
            <span className="hidden truncate text-xs md:inline" style={{ color: "var(--text-muted)" }}>
              · {subtitle}
            </span>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className={bodyClassName ?? "flex flex-1 flex-col gap-4 p-4"}>{children}</div>
      {footer ? (
        <footer
          className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2.5 text-xs"
          style={{ borderColor: "var(--border-hairline)", background: "var(--page-plane)", color: "var(--text-muted)" }}
        >
          {footer}
        </footer>
      ) : null}
    </section>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      className="inline-flex rounded-lg p-0.5"
      style={{ background: "var(--page-plane)", border: "1px solid var(--border-hairline)" }}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            title={o.title}
            onClick={() => onChange(o.value)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium"
            style={{
              background: active ? "var(--surface-1)" : "transparent",
              color: active ? "var(--text-primary)" : "var(--text-muted)",
              boxShadow: active ? "0 1px 2px rgba(0,0,0,0.08)" : undefined,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export type ChartView = "chart" | "table";

export function ChartTableToggle({ view, onChange }: { view: ChartView; onChange: (v: ChartView) => void }) {
  return (
    <Segmented
      ariaLabel="Chart or table view"
      value={view}
      onChange={onChange}
      options={[
        { value: "chart", label: <IconLineChart />, title: "Chart" },
        { value: "table", label: <IconTable />, title: "Table" },
      ]}
    />
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-xs"
      style={{ color: "var(--text-secondary)" }}
    >
      <span
        className="relative inline-block h-4 w-7 rounded-full transition-colors"
        style={{ background: checked ? "var(--series-1)" : "var(--gridline)" }}
      >
        <span
          className="absolute top-0.5 h-3 w-3 rounded-full transition-all"
          style={{ left: checked ? 14 : 2, background: "var(--surface-1)" }}
        />
      </span>
      {label}
    </button>
  );
}

/** A change figure: sign + arrow + ink color, so direction never depends on color alone. */
export function Delta({
  value,
  format,
  higherIsBetter = true,
  title,
}: {
  value: number | null;
  format: (abs: number) => string;
  higherIsBetter?: boolean;
  title?: string;
}) {
  if (value == null) return null;
  if (Math.abs(value) < 1e-9) {
    return (
      <span className="text-sm tabular" style={{ color: "var(--text-muted)" }} title={title}>
        ±0
      </span>
    );
  }
  const good = higherIsBetter ? value > 0 : value < 0;
  return (
    <span
      className="text-sm font-medium tabular"
      style={{ color: good ? "var(--success-text)" : "var(--status-critical)" }}
      title={title}
    >
      {value > 0 ? "▲ +" : "▼ −"}
      {format(Math.abs(value))}
    </span>
  );
}

export function Headline({ label, value, delta }: { label: string; value: string; delta?: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold" style={{ color: "var(--text-primary)" }}>
          {value}
        </span>
        {delta}
      </div>
    </div>
  );
}

export function Chip({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "good" | "muted";
  title?: string;
}) {
  const styles: Record<string, React.CSSProperties> = {
    neutral: { background: "var(--page-plane)", color: "var(--text-secondary)", borderColor: "var(--border-hairline)" },
    accent: { background: "color-mix(in srgb, var(--series-1) 12%, transparent)", color: "var(--text-primary)", borderColor: "color-mix(in srgb, var(--series-1) 35%, transparent)" },
    good: { background: "color-mix(in srgb, var(--status-good) 12%, transparent)", color: "var(--text-primary)", borderColor: "color-mix(in srgb, var(--status-good) 40%, transparent)" },
    muted: { background: "transparent", color: "var(--text-muted)", borderColor: "var(--border-hairline)" },
  };
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium" style={styles[tone]} title={title}>
      {children}
    </span>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div
      className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center"
      style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
    >
      <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        {title}
      </p>
      {body ? (
        <p className="max-w-md text-sm" style={{ color: "var(--text-muted)" }}>
          {body}
        </p>
      ) : null}
      {action}
    </div>
  );
}

export function SelectControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  icon,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
  icon?: ReactNode;
}) {
  return (
    <label
      className="relative inline-flex items-center gap-1.5 rounded-lg border py-1.5 pl-2.5 pr-7 text-xs font-medium"
      style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
    >
      {icon ? <span style={{ color: "var(--text-secondary)" }}>{icon}</span> : null}
      <span className="sr-only">{ariaLabel}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="absolute inset-0 cursor-pointer opacity-0"
        aria-label={ariaLabel}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span aria-hidden>{options.find((o) => o.value === value)?.label}</span>
      <svg className="pointer-events-none absolute right-2" width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        <path d="M2 3.5L5 6.5L8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </label>
  );
}

const iconProps = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.4, "aria-hidden": true } as const;

export function IconEye() {
  return (
    <svg {...iconProps}>
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  );
}
export function IconBars() {
  return (
    <svg {...iconProps}>
      <path d="M2.5 13.5V9M6.5 13.5V5M10.5 13.5V7.5M14 13.5H1.5" />
    </svg>
  );
}
export function IconHash() {
  return (
    <svg {...iconProps}>
      <path d="M6 2.5 4.5 13.5M11.5 2.5 10 13.5M2.5 6h11M2 10.5h11" />
    </svg>
  );
}
export function IconPie() {
  return (
    <svg {...iconProps}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 2v6h6" />
    </svg>
  );
}
export function IconMessage() {
  return (
    <svg {...iconProps}>
      <path d="M2.5 3.5h11v7.5H6l-3.5 2.5V3.5Z" />
    </svg>
  );
}
export function IconLink() {
  return (
    <svg {...iconProps}>
      <path d="M6.5 9.5 9.5 6.5M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1" />
    </svg>
  );
}
export function IconGlobe() {
  return (
    <svg {...iconProps}>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c1.8 2 1.8 10 0 12M8 2c-1.8 2-1.8 10 0 12" />
    </svg>
  );
}
export function IconLayers() {
  return (
    <svg {...iconProps}>
      <path d="M8 2 14 5 8 8 2 5 8 2ZM2 8l6 3 6-3M2 11l6 3 6-3" />
    </svg>
  );
}
export function IconLineChart() {
  return (
    <svg {...iconProps} width={14} height={14}>
      <path d="M1.5 12 5.5 7.5l3 2.5 6-6.5" />
    </svg>
  );
}
export function IconTable() {
  return (
    <svg {...iconProps} width={14} height={14}>
      <rect x="2" y="2.5" width="12" height="11" rx="1" />
      <path d="M2 6.5h12M2 10h12M6.5 6.5v7" />
    </svg>
  );
}
export function IconCalendar() {
  return (
    <svg {...iconProps} width={14} height={14}>
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M5 1.5v3M11 1.5v3" />
    </svg>
  );
}
export function IconFilter() {
  return (
    <svg {...iconProps} width={14} height={14}>
      <path d="M2 3h12L9.5 8.5v4.5l-3-1.5v-3L2 3Z" />
    </svg>
  );
}
export function IconCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <circle cx="8" cy="8" r="6.5" strokeWidth={1.4} />
      <path d="M5.2 8.2 7.1 10l3.7-4" />
    </svg>
  );
}

/** AI Overview / AI Mode marker used in the rank grid: filled when your brand is in the answer, outlined when the answer showed without it. */
export function SparkleMark({ filled, title }: { filled: boolean; title: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-label={title} role="img">
      <title>{title}</title>
      <path
        d="M8 1.2 9.5 6.5 14.8 8 9.5 9.5 8 14.8 6.5 9.5 1.2 8 6.5 6.5 8 1.2Z"
        fill={filled ? "var(--series-1)" : "none"}
        stroke={filled ? "var(--series-1)" : "var(--text-muted)"}
        strokeWidth={1.3}
      />
    </svg>
  );
}

export function ModeMark({ filled, title }: { filled: boolean; title: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-label={title} role="img">
      <title>{title}</title>
      <rect
        x="2"
        y="2"
        width="12"
        height="12"
        rx="3.5"
        fill={filled ? "var(--series-3)" : "none"}
        stroke={filled ? "var(--series-3)" : "var(--text-muted)"}
        strokeWidth={1.3}
      />
      <path d="M5 8h6M8 5v6" stroke={filled ? "var(--surface-1)" : "var(--text-muted)"} strokeWidth={1.3} />
    </svg>
  );
}

/** Adds a domain seen in the SERP as a tracked competitor. */
export function TrackButton({ onClick, label = "Track" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold"
      style={{
        borderColor: "color-mix(in srgb, var(--series-1) 45%, transparent)",
        color: "var(--series-1)",
        background: "var(--surface-1)",
      }}
      title="Track this site as a competitor"
    >
      + {label}
    </button>
  );
}

const GOOGLE_VIA_HELP: Record<string, string> = {
  "Google Things to Do": "Reached Google's answer through its Things to Do booking feed, not the operator's own page",
  "Google Business Profile": "Comes from a Google Business Profile (or its website button), not an independent page",
  "Google Maps": "A Google Maps listing",
  "Google Search": "A Google Search results view (search viewer), not an external page",
  "Google Travel": "A Google Travel page",
  "Google Hotels": "A Google Hotels listing",
  "Google Shopping": "A Google Shopping listing",
  Google: "A Google-hosted page",
};

/** Marks a citation that Google sourced from its own products/feeds rather than an independent website. */
export function GoogleViaBadge({ via, count }: { via: string; count?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold"
      style={{
        borderColor: "color-mix(in srgb, var(--series-4) 55%, transparent)",
        background: "color-mix(in srgb, var(--series-4) 14%, transparent)",
        color: "var(--text-primary)",
      }}
      title={GOOGLE_VIA_HELP[via] ?? "Sourced from a Google surface"}
    >
      <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden>
        <path d="M15.5 8.2c0-.6-.1-1.1-.2-1.6H8v3h4.2a3.6 3.6 0 0 1-1.6 2.4v2h2.6c1.5-1.4 2.3-3.4 2.3-5.8Z" fill="#4285F4" />
        <path d="M8 16c2.2 0 4-.7 5.3-1.9l-2.6-2a4.8 4.8 0 0 1-7.2-2.5H.9v2A8 8 0 0 0 8 16Z" fill="#34A853" />
        <path d="M3.5 9.6a4.8 4.8 0 0 1 0-3.1v-2H.9a8 8 0 0 0 0 7.2l2.6-2.1Z" fill="#FBBC05" />
        <path d="M8 3.2c1.2 0 2.3.4 3.2 1.2l2.3-2.3A8 8 0 0 0 .9 4.4l2.6 2A4.8 4.8 0 0 1 8 3.2Z" fill="#EA4335" />
      </svg>
      via {via}
      {count && count > 1 ? <span style={{ color: "var(--text-secondary)" }}>×{count}</span> : null}
    </span>
  );
}
