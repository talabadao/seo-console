"use client";

import { useEffect, useRef, useState } from "react";
import type { FilterState } from "@/lib/queryFilters";

export function FilterMenu({
  value,
  onChange,
  dimension,
  activeCount,
}: {
  value: FilterState;
  onChange: (f: FilterState) => void;
  dimension: string;
  activeCount: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch });
  const queryOnly = dimension === "query";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm ${
          activeCount ? "border-accent bg-accent-soft text-accent" : "bg-surface"
        }`}
      >
        Filters{activeCount ? ` · ${activeCount}` : ""}
      </button>

      {open && (
        <div className="absolute left-0 z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border bg-surface p-4 shadow-xl">
          <label className="text-xs font-semibold uppercase text-muted">Contains</label>
          <input
            value={value.contains}
            onChange={(e) => set({ contains: e.target.value })}
            placeholder="text in query / URL…"
            className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />

          <p className="mt-4 text-xs font-semibold uppercase text-muted">Position</p>
          <div className="mt-1 flex gap-1">
            {([0, 3, 10, 20] as const).map((n) => (
              <button
                key={n}
                onClick={() => set({ position: n })}
                className={`flex-1 rounded-md border px-2 py-1 text-sm ${
                  value.position === n ? "border-accent bg-accent-soft text-accent" : ""
                }`}
              >
                {n === 0 ? "Any" : `Top ${n}`}
              </button>
            ))}
          </div>

          <p className="mt-4 text-xs font-semibold uppercase text-muted">Trend vs comparison</p>
          <div className="mt-1 grid grid-cols-4 gap-1">
            {(["all", "growing", "decaying", "new"] as const).map((t) => (
              <button
                key={t}
                onClick={() => set({ trend: t })}
                className={`rounded-md border px-1 py-1 text-xs capitalize ${
                  value.trend === t ? "border-accent bg-accent-soft text-accent" : ""
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className={queryOnly ? "" : "opacity-40"}>
            <p className="mt-4 text-xs font-semibold uppercase text-muted">
              Query presets {queryOnly ? "" : "(Queries only)"}
            </p>
            <div className="mt-1 space-y-1">
              <Toggle
                label="Branded"
                on={value.branded === "branded"}
                onClick={() =>
                  set({ branded: value.branded === "branded" ? "all" : "branded" })
                }
                disabled={!queryOnly}
              />
              <Toggle
                label="Non-branded"
                on={value.branded === "nonbranded"}
                onClick={() =>
                  set({ branded: value.branded === "nonbranded" ? "all" : "nonbranded" })
                }
                disabled={!queryOnly}
              />
              <Toggle
                label="People Also Ask (questions)"
                on={value.question}
                onClick={() => set({ question: !value.question })}
                disabled={!queryOnly}
              />
              <Toggle
                label="Long-tail keywords"
                on={value.longtail}
                onClick={() => set({ longtail: !value.longtail })}
                disabled={!queryOnly}
              />
              <Toggle
                label="AI search prompts"
                on={value.ai}
                onClick={() => set({ ai: !value.ai })}
                disabled={!queryOnly}
              />
            </div>
          </div>

          {activeCount > 0 && (
            <button
              onClick={() =>
                onChange({
                  branded: "all",
                  position: 0,
                  question: false,
                  longtail: false,
                  ai: false,
                  contains: "",
                  trend: "all",
                })
              }
              className="mt-4 w-full rounded-md border px-2 py-1.5 text-sm text-bad"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Toggle({
  label,
  on,
  onClick,
  disabled,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-sm ${
        on ? "border-accent bg-accent-soft text-accent" : ""
      } disabled:cursor-not-allowed`}
    >
      {label}
      <span>{on ? "✓" : ""}</span>
    </button>
  );
}
