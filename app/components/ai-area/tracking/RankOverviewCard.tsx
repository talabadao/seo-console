"use client";

import { useState } from "react";
import type { RankOverview, Subject } from "@/lib/ai-area/tracking/analytics";
import { formatShortDate } from "@/lib/ai-area/tracking/format";
import { Favicon } from "./Favicon";

// Decorative tier markers (gold/silver/bronze) - identity comes from the labels, not the colors.
const TROPHY: Record<string, string> = { "1-3": "#E3A008", "4-5": "#8A94A6", "6-10": "#C07A3A" };

function Trophy({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M4 2h8v3a4 4 0 0 1-8 0V2Z" fill={color} />
      <path d="M4 3H2v1a2.5 2.5 0 0 0 2.5 2.5M12 3h2v1a2.5 2.5 0 0 1-2.5 2.5" stroke={color} strokeWidth="1.2" fill="none" />
      <path d="M7 9h2v2.5H7zM5 12.5h6V14H5z" fill={color} />
    </svg>
  );
}

function Movement({ up, down }: { up: number; down: number }) {
  return (
    <span className="flex items-center gap-3 text-xs tabular">
      <span className="flex items-center gap-1" style={{ color: "var(--success-text)" }} title={`${up} keyword(s) moved up`}>
        <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden>
          <path d="M1 9 5 5l2.5 2.5L13 1.5M13 1.5H9.5M13 1.5V5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
        <span style={{ color: "var(--text-secondary)" }}>{up}</span>
      </span>
      <span className="flex items-center gap-1" style={{ color: "var(--status-critical)" }} title={`${down} keyword(s) moved down`}>
        <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden>
          <path d="M1 1 5 5l2.5-2.5L13 8.5M13 8.5H9.5M13 8.5V5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
        <span style={{ color: "var(--text-secondary)" }}>{down}</span>
      </span>
    </span>
  );
}

/** A live screenshot of the tracked site (WordPress mShots, no key needed), falling back to its favicon. */
function SiteThumbnail({ subject }: { subject: Subject }) {
  const [failed, setFailed] = useState(false);
  const site = subject.website.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!site || failed) {
    return (
      <div className="flex h-full min-h-40 w-full items-center justify-center" style={{ background: "var(--page-plane)" }}>
        <Favicon domain={site} label={subject.name} size={48} />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external screenshot service, not worth next/image's remote allowlisting
    <img
      src={`https://s.wordpress.com/mshots/v1/${encodeURIComponent(`https://${site}`)}?w=640&h=400`}
      alt={`Homepage of ${site}`}
      className="h-full min-h-40 w-full object-cover object-top"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function RankOverviewCard({ subject, overview }: { subject: Subject; overview: RankOverview }) {
  return (
    <section
      className="grid grid-cols-1 overflow-hidden rounded-xl border md:grid-cols-[300px_minmax(0,1fr)]"
      style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
      aria-label={`Ranking overview for ${subject.website || subject.name}`}
    >
      <div className="border-b md:border-b-0 md:border-r" style={{ borderColor: "var(--border-hairline)" }}>
        <SiteThumbnail subject={subject} />
      </div>
      <div className="flex flex-col gap-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Favicon domain={subject.website} label={subject.name} size={20} />
            <span className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
              {subject.website || subject.name}
            </span>
            {subject.isYourBrand ? (
              <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "var(--gridline)", color: "var(--text-secondary)" }}>
                You
              </span>
            ) : null}
          </span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {overview.latestDate ? `Last updated ${formatShortDate(overview.latestDate)}` : "Not tracked yet"} · {overview.keywords} keyword
            {overview.keywords === 1 ? "" : "s"}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
          {overview.buckets.map((b) => (
            <div key={b.key} className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5 text-sm" style={{ color: "var(--text-secondary)" }}>
                {b.label}
                {TROPHY[b.key] ? <Trophy color={TROPHY[b.key]} /> : null}
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold" style={{ color: "var(--text-primary)" }}>
                  {b.count}
                </span>
                <span className="text-xs tabular" style={{ color: "var(--text-muted)" }}>
                  {Math.round(b.share * 100)}%
                </span>
              </span>
              <Movement up={b.up} down={b.down} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
