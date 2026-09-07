"use client";

import { useEffect, useRef, useState } from "react";
import { PRESETS, type CompareMode, type Grain, type PresetId } from "@/lib/dateRanges";

export interface RangeValue {
  preset: PresetId;
  start: string;
  end: string;
  grain: Grain;
  compareMode: CompareMode;
  matchWeekdays: boolean;
  compareStart?: string;
  compareEnd?: string;
}

const COMPARE_OPTIONS: { id: CompareMode; label: string }[] = [
  { id: "none", label: "Disabled" },
  { id: "previous", label: "Previous period" },
  { id: "yoy", label: "Year over year" },
  { id: "prevMonth", label: "Previous month" },
  { id: "custom", label: "Custom" },
];

export function DateRangePicker({
  value,
  resolvedRange,
  resolvedCompare,
  onChange,
}: {
  value: RangeValue;
  resolvedRange: { start: string; end: string };
  resolvedCompare: { start: string; end: string } | null;
  onChange: (v: RangeValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const presetLabel =
    PRESETS.find((p) => p.id === value.preset)?.label ?? "Custom range";

  const set = (patch: Partial<RangeValue>) => onChange({ ...value, ...patch });

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md border bg-surface px-3 py-1.5 text-sm"
      >
        <span className="font-medium">{presetLabel}</span>
        <span className="text-muted">
          {resolvedRange.start} → {resolvedRange.end}
        </span>
        <span className="text-muted">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 z-40 mt-2 flex w-[560px] max-w-[calc(100vw-2rem)] rounded-xl border bg-surface shadow-xl">
          {/* Left: comparison */}
          <div className="w-1/2 border-r p-4">
            <p className="text-xs font-semibold uppercase text-muted">Comparison period</p>
            <div className="mt-2 space-y-1">
              {COMPARE_OPTIONS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => set({ compareMode: c.id })}
                  className={`block w-full rounded-md px-2 py-1.5 text-left text-sm ${
                    value.compareMode === c.id ? "bg-accent-soft text-accent" : "hover:bg-background"
                  }`}
                >
                  {c.label}
                  {c.id === value.compareMode && resolvedCompare && c.id !== "none" && (
                    <span className="block text-xs text-muted">
                      {resolvedCompare.start} → {resolvedCompare.end}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {value.compareMode === "custom" && (
              <div className="mt-2 space-y-2">
                <input
                  type="date"
                  value={value.compareStart ?? ""}
                  onChange={(e) => set({ compareStart: e.target.value })}
                  className="w-full rounded border bg-background px-2 py-1 text-xs"
                />
                <input
                  type="date"
                  value={value.compareEnd ?? ""}
                  onChange={(e) => set({ compareEnd: e.target.value })}
                  className="w-full rounded border bg-background px-2 py-1 text-xs"
                />
              </div>
            )}

            <label className="mt-4 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={value.matchWeekdays}
                onChange={(e) => set({ matchWeekdays: e.target.checked })}
              />
              Match weekdays
            </label>
          </div>

          {/* Right: grain + presets */}
          <div className="w-1/2 p-4">
            <div className="mb-3 flex rounded-md border p-0.5 text-sm">
              {(["day", "week", "month"] as Grain[]).map((g) => (
                <button
                  key={g}
                  onClick={() => set({ grain: g })}
                  className={`flex-1 rounded px-2 py-1 capitalize ${
                    value.grain === g ? "bg-accent text-white" : "text-muted"
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>

            <div className="max-h-72 space-y-0.5 overflow-auto">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    set({ preset: p.id });
                    if (p.id !== "custom") setOpen(false);
                  }}
                  className={`block w-full rounded-md px-2 py-1.5 text-left text-sm ${
                    value.preset === p.id ? "bg-accent-soft text-accent" : "hover:bg-background"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {value.preset === "custom" && (
              <div className="mt-2 space-y-2">
                <input
                  type="date"
                  value={value.start}
                  onChange={(e) => set({ start: e.target.value })}
                  className="w-full rounded border bg-background px-2 py-1 text-xs"
                />
                <input
                  type="date"
                  value={value.end}
                  onChange={(e) => set({ end: e.target.value })}
                  className="w-full rounded border bg-background px-2 py-1 text-xs"
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
