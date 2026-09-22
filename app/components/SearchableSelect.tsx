"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface SelectOption {
  value: string;
  label: string;
  sublabel?: string;
}

/**
 * A `<select>` replacement with a filter box — for GSC/GA4 property pickers
 * whose option list can run into the dozens, where a plain dropdown makes
 * finding one property a scroll-and-squint exercise.
 */
export function SearchableSelect({
  value,
  options,
  onChange,
  placeholder = "No properties",
  className = "",
}: {
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(needle) || (o.sublabel ?? "").toLowerCase().includes(needle),
    );
  }, [options, q]);

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={!options.length}
        className="flex w-full items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-left text-sm disabled:opacity-50"
      >
        <span className="flex-1 truncate">
          {current
            ? current.sublabel
              ? `${current.sublabel} · ${current.label}`
              : current.label
            : placeholder}
        </span>
        <span className="text-muted">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 z-40 mt-1 w-full min-w-64 rounded-lg border bg-surface shadow-xl">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="w-full border-b bg-transparent px-3 py-2 text-sm outline-none"
          />
          <div className="max-h-72 overflow-auto py-1">
            {filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-accent-soft ${
                  o.value === value ? "bg-accent-soft text-accent" : ""
                }`}
                title={o.sublabel ? `${o.sublabel} · ${o.label}` : o.label}
              >
                {o.sublabel && <span className="text-muted">{o.sublabel} · </span>}
                {o.label}
              </button>
            ))}
            {!filtered.length && <p className="px-3 py-2 text-sm text-muted">No matches.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
