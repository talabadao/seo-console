"use client";

import { useState } from "react";

interface Inspection {
  url: string;
  inspected_at: number;
  verdict: string | null;
  coverage_state: string | null;
  robots_txt_state: string | null;
  indexing_state: string | null;
  page_fetch_state: string | null;
  last_crawl_time: string | null;
  google_canonical: string | null;
  user_canonical: string | null;
  crawled_as: string | null;
}

const VERDICT_COLOR: Record<string, string> = {
  PASS: "var(--good)",
  NEUTRAL: "var(--muted)",
  FAIL: "var(--bad)",
};

export function UrlInspector({ property }: { property: string }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Inspection | null>(null);
  const [cached, setCached] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function inspect(force = false) {
    if (!url || !property) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property, url, force }),
      });
      const json = await res.json();
      if (res.ok) {
        setResult(json.result);
        setCached(json.cached);
      } else {
        setError(json.error ?? "Inspection failed");
      }
    } finally {
      setBusy(false);
    }
  }

  const rows: [string, string | null][] = result
    ? [
        ["Coverage", result.coverage_state],
        ["Indexing allowed", result.indexing_state],
        ["robots.txt", result.robots_txt_state],
        ["Page fetch", result.page_fetch_state],
        ["Crawled as", result.crawled_as],
        ["Last crawl", result.last_crawl_time],
        ["Google-selected canonical", result.google_canonical],
        ["User-declared canonical", result.user_canonical],
      ]
    : [];

  return (
    <div className="max-w-3xl">
      <p className="mb-3 text-sm text-muted">
        Live URL Inspection for <span className="font-medium text-foreground">{property || "—"}</span>.
        Quota: 2,000 URLs/day per property (Google limit). Results cache for 24h.
      </p>
      <div className="flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && inspect()}
          placeholder="https://example.com/page"
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
        />
        <button
          onClick={() => inspect(false)}
          disabled={busy || !property}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Inspecting…" : "Inspect"}
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-5 rounded-xl border bg-surface p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className="rounded-full px-2.5 py-1 text-xs font-semibold text-white"
                style={{ background: VERDICT_COLOR[result.verdict ?? "NEUTRAL"] ?? "var(--muted)" }}
              >
                {result.verdict ?? "UNKNOWN"}
              </span>
              <span className="text-sm text-muted">
                {cached ? "cached" : "fresh"} ·{" "}
                {new Date(result.inspected_at).toLocaleString()}
              </span>
            </div>
            <button
              onClick={() => inspect(true)}
              disabled={busy}
              className="text-xs text-accent"
            >
              Re-check (uses quota)
            </button>
          </div>

          <dl className="mt-4 divide-y">
            {rows.map(([label, value]) => (
              <div key={label} className="flex gap-4 py-2 text-sm">
                <dt className="w-56 shrink-0 text-muted">{label}</dt>
                <dd className="break-all">{value || "—"}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
