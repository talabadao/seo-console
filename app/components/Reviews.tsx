"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from "date-fns";
import {
  OTHER,
  type Polarity,
  type Review,
  type ReviewsData,
  type Sentiment,
} from "@/lib/reviewTypes";

type Data = ReviewsData & { needsReconnect: boolean };

const PERIODS = [
  { id: "7d", label: "7 days", days: 7 },
  { id: "28d", label: "28 days", days: 28 },
  { id: "3m", label: "3 months", days: 91 },
  { id: "6m", label: "6 months", days: 182 },
  { id: "12m", label: "12 months", days: 365 },
  { id: "all", label: "All", days: 0 },
] as const;
type PeriodId = (typeof PERIODS)[number]["id"];

const SENTIMENT: Record<Sentiment, { label: string; color: string }> = {
  positive: { label: "Positive", color: "var(--good)" },
  mixed: { label: "Mixed", color: "var(--muted)" },
  neutral: { label: "Neutral", color: "var(--neutral-soft)" },
  negative: { label: "Negative", color: "var(--bad)" },
};
const SENTIMENT_ORDER: Sentiment[] = ["positive", "mixed", "neutral", "negative"];

const POLARITY: Record<Polarity, { sign: string; label: string; color: string }> = {
  praise: { sign: "+", label: "Praise", color: "var(--good)" },
  criticism: { sign: "−", label: "Criticism", color: "var(--bad)" },
};

// ---------- time buckets ----------

type Grain = "day" | "week" | "month" | "year";
const GRAINS: Grain[] = ["day", "week", "month", "year"];

const floor: Record<Grain, (d: Date) => Date> = {
  day: startOfDay,
  week: (d) => startOfWeek(d, { weekStartsOn: 1 }),
  month: startOfMonth,
  year: startOfYear,
};
const step: Record<Grain, (d: Date) => Date> = {
  day: (d) => addDays(d, 1),
  week: (d) => addWeeks(d, 1),
  month: (d) => addMonths(d, 1),
  year: (d) => addYears(d, 1),
};

interface Bucket {
  start: number;
  end: number;
  /** Short axis label, and the full range for tooltips. */
  label: string;
  title: string;
}

/** Splits [from, to] into the finest buckets that still fit in `max` columns. */
function bucketsFor(from: number, to: number, max: number): Bucket[] {
  for (const grain of GRAINS) {
    const out: Bucket[] = [];
    for (let d = floor[grain](new Date(from)); d.getTime() <= to && out.length <= max; d = step[grain](d)) {
      const start = Math.max(d.getTime(), from);
      const end = Math.min(step[grain](d).getTime() - 1, to);
      const sameDay = format(start, "yyyyMMdd") === format(end, "yyyyMMdd");
      out.push({
        start,
        end,
        label:
          grain === "year"
            ? format(d, "yyyy")
            : grain === "month"
              ? format(d, d.getMonth() === 0 || !out.length ? "MMM yy" : "MMM")
              : format(start, "MMM d"),
        title: sameDay
          ? format(start, "MMM d, yyyy")
          : `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`,
      });
    }
    if (out.length <= max || grain === "year") return out.slice(-max);
  }
  return [];
}

// ---------- aggregation ----------

interface Kpis {
  count: number;
  rating: number | null;
  positive: number | null;
  negative: number | null;
  replied: number | null;
}

function kpisOf(reviews: Review[]): Kpis {
  const n = reviews.length;
  if (!n) return { count: 0, rating: null, positive: null, negative: null, replied: null };
  const rated = reviews.filter((r) => r.star > 0);
  return {
    count: n,
    rating: rated.length ? rated.reduce((s, r) => s + r.star, 0) / rated.length : null,
    positive: (reviews.filter((r) => r.sentiment === "positive").length / n) * 100,
    negative: (reviews.filter((r) => r.sentiment === "negative").length / n) * 100,
    replied: (reviews.filter((r) => r.reply).length / n) * 100,
  };
}

/** Whether a review makes at least one point about this aspect with this polarity. */
const mentions = (r: Review, aspect: string, polarity: Polarity) =>
  r.points.some((p) => p.aspect === aspect && p.polarity === polarity);

interface AspectFilter {
  aspect: string;
  polarity: Polarity;
  bucket?: Bucket;
}

export function Reviews({
  projectId,
  projectName,
  onEditProject,
}: {
  projectId: number;
  projectName: string;
  onEditProject: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [period, setPeriod] = useState<PeriodId>("12m");
  const [busy, setBusy] = useState<"sync" | "analyze" | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [msg, setMsg] = useState<{ text: string; enableUrl?: string | null } | null>(null);
  const [sentiment, setSentiment] = useState<Sentiment | "all">("all");
  const [q, setQ] = useState("");
  const [aspectFilter, setAspectFilter] = useState<AspectFilter | null>(null);
  const [shown, setShown] = useState(20);
  // Fixed for the life of the tab so period maths doesn't shift between renders.
  const [now] = useState(() => Date.now());
  const autoStarted = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (): Promise<Data | null> => {
    const res = await fetch(`/api/reviews?projectId=${projectId}`);
    if (!res.ok) return null;
    const j = (await res.json()) as Data;
    setData(j);
    return j;
  }, [projectId]);

  /** Runs the classifier in rounds until nothing is left (or a round makes no progress). */
  const analyze = useCallback(
    async (total: number) => {
      setBusy("analyze");
      setProgress({ done: 0, total });
      try {
        let remaining = total;
        while (remaining > 0) {
          const res = await fetch("/api/reviews/classify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId }),
          });
          const j = (await res.json().catch(() => ({}))) as {
            classified?: number;
            remaining?: number;
            error?: string;
          };
          if (!res.ok || j.error) {
            setMsg({ text: `Review analysis stopped: ${j.error ?? "the request failed"}` });
            break;
          }
          remaining = j.remaining ?? 0;
          setProgress({ done: total - remaining, total });
          await load();
          if (!j.classified) break;
        }
      } finally {
        setBusy(null);
        setProgress(null);
      }
    },
    [projectId, load],
  );

  const sync = useCallback(async () => {
    setBusy("sync");
    setMsg(null);
    let fresh: Data | null = null;
    try {
      const res = await fetch("/api/reviews/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setMsg({ text: j.error ?? "Couldn't fetch reviews from Google.", enableUrl: j.enableUrl });
      fresh = await load();
    } finally {
      setBusy(null);
    }
    if (fresh?.classifier && fresh.pending > 0) await analyze(fresh.pending);
  }, [projectId, load, analyze]);

  // First visit: fetch from Google straight away; later visits just resume any
  // analysis that was left unfinished.
  useEffect(() => {
    (async () => {
      const j = await load();
      if (!j || autoStarted.current || j.needsReconnect) return;
      autoStarted.current = true;
      if (!j.syncedAt) await sync();
      else if (j.classifier && j.pending > 0) await analyze(j.pending);
    })();
  }, [load, sync, analyze]);

  const view = useMemo(() => {
    const all = data?.reviews ?? [];
    const days = PERIODS.find((p) => p.id === period)!.days;
    const oldest = all.length ? all[all.length - 1].time : now;
    const from = days ? startOfDay(new Date(now - days * 86400000)).getTime() : oldest;
    const current = all.filter((r) => r.time >= from && r.time <= now);
    const previous = days ? all.filter((r) => r.time >= from - days * 86400000 && r.time < from) : [];

    const aspects = [...new Set([...(data?.aspects ?? []), ...current.flatMap((r) => r.points.map((p) => p.aspect))])];
    const rows = aspects
      .map((aspect) => {
        const praise = current.filter((r) => mentions(r, aspect, "praise"));
        const criticism = current.filter((r) => mentions(r, aspect, "criticism"));
        return { aspect, praise, criticism };
      })
      .filter((a) => a.praise.length + a.criticism.length > 0)
      .sort(
        (a, b) =>
          Number(a.aspect === OTHER) - Number(b.aspect === OTHER) ||
          b.praise.length + b.criticism.length - (a.praise.length + a.criticism.length),
      );

    return {
      from,
      current,
      kpis: kpisOf(current),
      prev: days && previous.length ? kpisOf(previous) : null,
      chartBuckets: bucketsFor(from, now, 31),
      heatBuckets: bucketsFor(from, now, 13),
      rows,
    };
  }, [data, period, now]);

  const current = view.current;
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return current.filter((r) => {
      if (sentiment !== "all" && r.sentiment !== sentiment) return false;
      if (aspectFilter) {
        if (!mentions(r, aspectFilter.aspect, aspectFilter.polarity)) return false;
        const b = aspectFilter.bucket;
        if (b && (r.time < b.start || r.time > b.end)) return false;
      }
      if (needle) {
        const hay = `${r.comment} ${r.commentEn ?? ""} ${r.reviewer}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [current, sentiment, aspectFilter, q]);

  function pickAspect(f: AspectFilter) {
    setAspectFilter(f);
    setShown(20);
    listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (!data) return <p className="py-10 text-center text-sm text-muted">Loading reviews…</p>;

  const analysed = data.reviews.some((r) => r.analyzed && r.points.length);

  return (
    <div className="space-y-4">
      {/* location header */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-surface p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-semibold">{data.locationTitle || projectName}</h2>
            <span className="rounded bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent">
              Google Business Profile
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted">
            {[
              data.averageRating != null ? `${data.averageRating.toFixed(1)} ★ on Google` : null,
              data.totalReviews != null ? `${data.totalReviews.toLocaleString()} reviews on Google` : null,
              `${data.reviews.length.toLocaleString()} saved`,
              data.syncedAt ? `updated ${format(data.syncedAt, "MMM d, HH:mm")}` : "not fetched yet",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <button
          onClick={sync}
          disabled={busy !== null || data.needsReconnect}
          className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent-soft disabled:opacity-50"
        >
          {busy === "sync" ? "Fetching…" : "Refresh"}
        </button>
        <button onClick={onEditProject} className="text-sm text-muted hover:text-foreground">
          Change location
        </button>
      </div>

      {data.needsReconnect && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm">
          <span>
            <strong>Google Business Profile isn&apos;t connected.</strong> Sign in again and approve the
            Business Profile permission to fetch reviews.
          </span>
          <a href="/api/auth/google" className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white">
            Reconnect Google
          </a>
        </div>
      )}
      {(msg || data.syncError) && (
        <div className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm">
          {msg?.text ?? `The last refresh failed: ${data.syncError}`}{" "}
          {msg?.enableUrl && (
            <a href={msg.enableUrl} target="_blank" rel="noreferrer" className="text-accent underline">
              Enable it in Google Cloud ↗
            </a>
          )}
        </div>
      )}
      {!data.classifier && data.reviews.length > 0 && (
        <div className="rounded-lg border bg-surface p-3 text-sm text-muted">
          Sentiment is based on star ratings only, and praise / criticism tags are off, because no
          classifier key is set. Add <code>OPENAI_API_KEY</code> to the Vercel project and redeploy to
          turn on full analysis.
        </div>
      )}
      {progress && (
        <div className="rounded-lg border bg-surface p-3">
          <div className="mb-1.5 flex items-center justify-between text-sm">
            <span className="font-medium">Analysing reviews…</span>
            <span className="tabular-nums text-muted">
              {progress.done.toLocaleString()} / {progress.total.toLocaleString()}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full border bg-background">
            <div
              className={`h-full rounded-full bg-accent transition-all ${progress.done ? "" : "animate-pulse"}`}
              style={{ width: `${Math.max(3, Math.round((progress.done / progress.total) * 100))}%` }}
            />
          </div>
        </div>
      )}

      {/* period */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-md border p-0.5 text-sm">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setPeriod(p.id);
                setAspectFilter(null);
                setShown(20);
              }}
              className={`rounded px-3 py-1 ${period === p.id ? "bg-accent font-medium text-white" : "text-muted"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted">
          {format(view.from, "MMM d, yyyy")} – {format(now, "MMM d, yyyy")}
        </span>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Reviews" value={view.kpis.count.toLocaleString()} cur={view.kpis.count} prev={view.prev?.count} />
        <Kpi
          label="Average rating"
          value={view.kpis.rating?.toFixed(2) ?? "—"}
          cur={view.kpis.rating}
          prev={view.prev?.rating}
          digits={2}
        />
        <Kpi
          label="Positive reviews"
          value={pct(view.kpis.positive)}
          cur={view.kpis.positive}
          prev={view.prev?.positive}
          unit=" pts"
        />
        <Kpi
          label="Negative reviews"
          value={pct(view.kpis.negative)}
          cur={view.kpis.negative}
          prev={view.prev?.negative}
          unit=" pts"
          lowerIsBetter
        />
        <Kpi
          label="Owner replies"
          value={pct(view.kpis.replied)}
          cur={view.kpis.replied}
          prev={view.prev?.replied}
          unit=" pts"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SentimentChart reviews={view.current} buckets={view.chartBuckets} />
        <StarRatings reviews={view.current} />
      </div>

      {analysed ? (
        <>
          <Heatmap rows={view.rows} buckets={view.heatBuckets} active={aspectFilter} onPick={pickAspect} />
          <div className="grid gap-4 lg:grid-cols-2">
            <TopList polarity="praise" rows={view.rows} total={view.current.length} onPick={pickAspect} />
            <TopList polarity="criticism" rows={view.rows} total={view.current.length} onPick={pickAspect} />
          </div>
        </>
      ) : (
        data.classifier &&
        data.reviews.length > 0 &&
        !progress && (
          <div className="rounded-xl border bg-surface p-6 text-center text-sm text-muted">
            Praise and criticism by aspect appear here once the reviews have been analysed.
          </div>
        )
      )}

      {/* review list */}
      <div className="rounded-xl border bg-surface" ref={listRef}>
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
          <h3 className="text-sm font-semibold">Reviews</h3>
          <span className="text-sm text-muted">
            {filtered.length.toLocaleString()} of {view.current.length.toLocaleString()} in this period
          </span>
          <div className="ml-auto flex rounded-md border p-0.5 text-sm">
            {(["all", "positive", "mixed", "negative"] as const).map((s) => (
              <button
                key={s}
                onClick={() => {
                  setSentiment(s);
                  setShown(20);
                }}
                className={`rounded px-3 py-1 ${sentiment === s ? "bg-accent font-medium text-white" : "text-muted"}`}
              >
                {s === "all" ? "All" : SENTIMENT[s].label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 px-4 pt-3">
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setShown(20);
            }}
            placeholder="Search review text"
            className="w-64 rounded-md border bg-background px-3 py-1.5 text-sm"
          />
          {aspectFilter ? (
            <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm">
              <Dot color={POLARITY[aspectFilter.polarity].color} />
              {POLARITY[aspectFilter.polarity].label} · {aspectFilter.aspect}
              {aspectFilter.bucket ? ` · ${aspectFilter.bucket.title}` : ""}
              <button onClick={() => setAspectFilter(null)} className="text-muted hover:text-foreground" aria-label="Clear">
                ✕
              </button>
            </span>
          ) : (
            analysed && (
              <span className="text-sm text-muted">
                Click the heatmap or the praise / criticism lists to filter by aspect.
              </span>
            )
          )}
        </div>
        <div className="divide-y px-4">
          {filtered.slice(0, shown).map((r) => (
            <ReviewItem key={r.id} r={r} />
          ))}
          {!filtered.length && (
            <p className="py-10 text-center text-sm text-muted">
              {data.reviews.length ? "No reviews match." : "No reviews saved yet."}
            </p>
          )}
        </div>
        {filtered.length > shown && (
          <div className="border-t p-3 text-center">
            <button
              onClick={() => setShown((n) => n + 30)}
              className="rounded-md border px-4 py-1.5 text-sm font-medium hover:bg-accent-soft"
            >
              Show more ({(filtered.length - shown).toLocaleString()} left)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v)}%`);

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />;
}

function Kpi({
  label,
  value,
  cur,
  prev,
  unit = "",
  digits = 0,
  lowerIsBetter = false,
}: {
  label: string;
  value: string;
  cur: number | null;
  prev: number | null | undefined;
  unit?: string;
  digits?: number;
  lowerIsBetter?: boolean;
}) {
  const diff = cur != null && prev != null ? cur - prev : null;
  const rounded = diff == null ? null : Number(diff.toFixed(digits));
  const good = rounded == null || rounded === 0 ? null : rounded > 0 !== lowerIsBetter;
  return (
    <div className="rounded-xl border bg-surface p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {rounded != null && rounded !== 0 && (
          <span
            className="text-sm font-medium tabular-nums"
            style={{ color: good ? "var(--good)" : "var(--bad)" }}
            title="Change from the previous period of the same length"
          >
            {rounded > 0 ? "▲ +" : "▼ −"}
            {Math.abs(rounded).toFixed(digits)}
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

function SentimentChart({ reviews, buckets }: { reviews: Review[]; buckets: Bucket[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const cols = useMemo(
    () =>
      buckets.map((b) => {
        const inB = reviews.filter((r) => r.time >= b.start && r.time <= b.end);
        const counts = Object.fromEntries(
          SENTIMENT_ORDER.map((s) => [s, inB.filter((r) => r.sentiment === s).length]),
        ) as Record<Sentiment, number>;
        return { bucket: b, total: inB.length, counts };
      }),
    [reviews, buckets],
  );
  const max = Math.max(1, ...cols.map((c) => c.total));
  const focus = cols[hover ?? cols.length - 1];
  const every = Math.ceil(cols.length / 8);

  return (
    <div className="rounded-xl border bg-surface p-4 lg:col-span-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="text-sm font-semibold">Sentiment over time</h3>
        <span className="text-xs text-muted">reviews per period by overall sentiment</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {SENTIMENT_ORDER.map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <Dot color={SENTIMENT[s].color} />
            {SENTIMENT[s].label}
          </span>
        ))}
      </div>
      {focus && (
        <p className="mt-2 text-sm">
          <span className="font-medium">{focus.bucket.title}</span>
          <span className="text-muted">
            {" "}
            · {focus.total} review{focus.total === 1 ? "" : "s"}
            {SENTIMENT_ORDER.filter((s) => focus.counts[s]).map(
              (s) => ` · ${focus.counts[s]} ${SENTIMENT[s].label.toLowerCase()}`,
            )}
          </span>
        </p>
      )}
      <div className="mt-3 flex h-52 items-end gap-0.5 border-b" onMouseLeave={() => setHover(null)}>
        {cols.map((c, i) => (
          <div
            key={c.bucket.start}
            onMouseEnter={() => setHover(i)}
            className="flex h-full min-w-0 flex-1 flex-col-reverse gap-0.5"
            style={{ opacity: hover == null || hover === i ? 1 : 0.55 }}
          >
            {SENTIMENT_ORDER.filter((s) => c.counts[s]).map((s) => (
              <div
                key={s}
                className="first:rounded-b-none last:rounded-t"
                style={{
                  height: `${(c.counts[s] / max) * 100}%`,
                  minHeight: 2,
                  background: SENTIMENT[s].color,
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-0.5 text-[11px] text-muted">
        {cols.map((c, i) => (
          <span key={c.bucket.start} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">
            {i % every === 0 ? c.bucket.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function StarRatings({ reviews }: { reviews: Review[] }) {
  const n = reviews.length;
  return (
    <div className="rounded-xl border bg-surface p-4">
      <div className="flex items-baseline gap-x-3">
        <h3 className="text-sm font-semibold">Star ratings</h3>
        <span className="text-xs text-muted">{n.toLocaleString()} reviews</span>
      </div>
      <div className="mt-4 space-y-3">
        {[5, 4, 3, 2, 1].map((star) => {
          const count = reviews.filter((r) => r.star === star).length;
          const share = n ? (count / n) * 100 : 0;
          return (
            <div key={star} className="flex items-center gap-3 text-sm">
              <span className="w-8 shrink-0 tabular-nums">
                {star} <span style={{ color: "var(--position)" }}>★</span>
              </span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-background">
                <div className="h-full rounded-full" style={{ width: `${share}%`, background: "var(--position)" }} />
              </div>
              <span className="w-20 shrink-0 text-right tabular-nums">
                {count.toLocaleString()} <span className="text-muted">({Math.round(share)}%)</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface AspectRow {
  aspect: string;
  praise: Review[];
  criticism: Review[];
}

/** Background for a count cell: the polarity's hue, stronger with more mentions. */
function shade(color: string, count: number, max: number): string {
  if (!count) return "transparent";
  const strength = 14 + Math.round((count / Math.max(1, max)) * 42);
  return `color-mix(in srgb, ${color} ${strength}%, var(--surface))`;
}

function Heatmap({
  rows,
  buckets,
  active,
  onPick,
}: {
  rows: AspectRow[];
  buckets: Bucket[];
  active: AspectFilter | null;
  onPick: (f: AspectFilter) => void;
}) {
  const inBucket = (list: Review[], b: Bucket) => list.filter((r) => r.time >= b.start && r.time <= b.end).length;
  const totalMax = Math.max(1, ...rows.flatMap((r) => [r.praise.length, r.criticism.length]));
  const cellMax = Math.max(
    1,
    ...rows.flatMap((r) => buckets.flatMap((b) => [inBucket(r.praise, b), inBucket(r.criticism, b)])),
  );
  const isActive = (aspect: string, polarity: Polarity, b?: Bucket) =>
    active?.aspect === aspect && active.polarity === polarity && active.bucket?.start === b?.start;

  return (
    <div className="rounded-xl border bg-surface">
      <div className="flex flex-wrap items-baseline gap-x-3 border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Praise &amp; criticism heatmap</h3>
        <span className="text-xs text-muted">specific points customers raise, by aspect and period</span>
      </div>
      <div className="overflow-x-auto p-4">
        <table className="w-full border-separate border-spacing-0.5 text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="px-2 pb-1 text-left font-medium">Aspect</th>
              <th className="px-2 pb-1 font-medium">+ Praise</th>
              <th className="px-2 pb-1 font-medium">− Criticism</th>
              <th className="px-2 pb-1 text-left font-medium">Positive</th>
              {buckets.map((b) => (
                <th key={b.start} className="whitespace-nowrap px-1 pb-1 font-normal" title={b.title}>
                  {b.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const p = row.praise.length;
              const c = row.criticism.length;
              const share = Math.round((p / (p + c)) * 100);
              return (
                <tr key={row.aspect}>
                  <td className="whitespace-nowrap px-2 font-medium">{row.aspect}</td>
                  {(["praise", "criticism"] as const).map((pol) => {
                    const n = pol === "praise" ? p : c;
                    return (
                      <td key={pol} className="w-20 p-0">
                        <button
                          onClick={() => n && onPick({ aspect: row.aspect, polarity: pol })}
                          disabled={!n}
                          className={`h-10 w-full rounded text-base font-semibold tabular-nums ${
                            isActive(row.aspect, pol) ? "outline outline-2 outline-accent" : ""
                          }`}
                          style={{ background: shade(POLARITY[pol].color, n, totalMax) }}
                          title={`${n} review${n === 1 ? "" : "s"} with ${pol} of ${row.aspect}`}
                        >
                          {n || ""}
                        </button>
                      </td>
                    );
                  })}
                  <td className="whitespace-nowrap px-2">
                    <span className="flex items-center gap-2">
                      <span className="flex h-2 w-14 overflow-hidden rounded-full" style={{ background: "var(--bad)" }}>
                        <span style={{ width: `${share}%`, background: "var(--good)" }} />
                      </span>
                      <span className="tabular-nums text-muted">{share}%</span>
                    </span>
                  </td>
                  {buckets.map((b) => (
                    <td key={b.start} className="min-w-9 p-0 align-middle">
                      <div className="flex flex-col gap-0.5">
                        {(["praise", "criticism"] as const).map((pol) => {
                          const n = inBucket(row[pol], b);
                          return (
                            <button
                              key={pol}
                              onClick={() => n && onPick({ aspect: row.aspect, polarity: pol, bucket: b })}
                              disabled={!n}
                              className={`h-[18px] w-full rounded-sm text-[11px] font-medium leading-none tabular-nums ${
                                isActive(row.aspect, pol, b) ? "outline outline-2 outline-accent" : ""
                              }`}
                              style={{ background: shade(POLARITY[pol].color, n, cellMax) }}
                              title={`${b.title}: ${n} review${n === 1 ? "" : "s"} with ${pol} of ${row.aspect}`}
                            >
                              {n || ""}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted">
          {(["praise", "criticism"] as const).map((pol) => (
            <span key={pol} className="flex items-center gap-2">
              {POLARITY[pol].sign} {POLARITY[pol].label}
              <span
                className="h-2 w-20 rounded-full"
                style={{
                  background: `linear-gradient(to right, ${shade(POLARITY[pol].color, 1, 100)}, ${shade(POLARITY[pol].color, 100, 100)})`,
                }}
              />
            </span>
          ))}
          <span>
            Darker = more reviews mention it. Each period cell: praise on top, criticism below. Click any
            cell to read those reviews.
          </span>
        </div>
      </div>
    </div>
  );
}

function TopList({
  polarity,
  rows,
  total,
  onPick,
}: {
  polarity: Polarity;
  rows: AspectRow[];
  total: number;
  onPick: (f: AspectFilter) => void;
}) {
  const meta = POLARITY[polarity];
  const list = rows
    .map((r) => ({ aspect: r.aspect, reviews: r[polarity] }))
    .filter((r) => r.reviews.length)
    .sort((a, b) => b.reviews.length - a.reviews.length)
    .slice(0, 6);
  const max = Math.max(1, ...list.map((r) => r.reviews.length));
  return (
    <div className="rounded-xl border bg-surface">
      <div className="flex flex-wrap items-baseline gap-x-3 border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Top {meta.label.toLowerCase()}</h3>
        <span className="text-xs text-muted">
          {polarity === "praise" ? "what customers love" : "what customers complain about"}
        </span>
      </div>
      <div className="space-y-4 p-4">
        {list.map((r) => {
          const quotes = r.reviews
            .flatMap((rv) => rv.points.filter((p) => p.aspect === r.aspect && p.polarity === polarity))
            .slice(0, 2);
          return (
            <button
              key={r.aspect}
              onClick={() => onPick({ aspect: r.aspect, polarity })}
              className="block w-full text-left"
            >
              <span className="flex items-center gap-3">
                <span className="flex-1 truncate text-sm font-medium">{r.aspect}</span>
                <span className="h-2 w-32 overflow-hidden rounded-full bg-background">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${(r.reviews.length / max) * 100}%`, background: meta.color }}
                  />
                </span>
                <span className="w-10 text-right text-sm tabular-nums text-muted">{r.reviews.length}</span>
              </span>
              {quotes.map((p, i) => (
                <span
                  key={i}
                  className="mt-1.5 block border-l-2 pl-3 text-sm italic text-muted"
                  style={{ borderColor: meta.color }}
                >
                  “{p.quote}”
                </span>
              ))}
            </button>
          );
        })}
        {!list.length && <p className="text-sm text-muted">Nothing in this period.</p>}
        {list.length > 0 && (
          <p className="text-xs text-muted">
            Counts are reviews that make the point, out of {total.toLocaleString()} in this period; one
            review can praise one thing and criticise another.
          </p>
        )}
      </div>
    </div>
  );
}

function ReviewItem({ r }: { r: Review }) {
  const [original, setOriginal] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const text = r.commentEn && !original ? r.commentEn : r.comment;
  const long = text.length > 420;
  // One tag per aspect and polarity, however many points the review makes about it.
  const tags = [...new Map(r.points.map((p) => [`${p.polarity}:${p.aspect}`, p])).values()];
  return (
    <div className="py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span aria-label={`${r.star} out of 5 stars`} className="tracking-tight">
          <span style={{ color: "var(--position)" }}>{"★".repeat(r.star)}</span>
          <span className="text-border">{"★".repeat(Math.max(0, 5 - r.star))}</span>
        </span>
        <span className="text-muted">{format(r.time, "MMM d, yyyy")}</span>
        <span className="font-medium">{r.reviewer || "Google user"}</span>
        <span className="inline-flex items-center gap-1.5">
          <Dot color={SENTIMENT[r.sentiment].color} />
          {SENTIMENT[r.sentiment].label}
        </span>
      </div>
      {text ? (
        <p className="mt-2 whitespace-pre-line text-sm">
          {long && !expanded ? `${text.slice(0, 420).trimEnd()}… ` : `${text} `}
          {long && (
            <button onClick={() => setExpanded((e) => !e)} className="text-accent hover:underline">
              {expanded ? "Less" : "More"}
            </button>
          )}{" "}
          {r.commentEn && (
            <button onClick={() => setOriginal((o) => !o)} className="text-accent hover:underline">
              {original ? "Show translation" : "Show original"}
            </button>
          )}
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted">Rating only, no text.</p>
      )}
      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((p) => (
            <span
              key={`${p.polarity}:${p.aspect}`}
              className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs"
              title={p.quote}
            >
              <Dot color={POLARITY[p.polarity].color} />
              {POLARITY[p.polarity].sign} {p.aspect}
            </span>
          ))}
        </div>
      )}
      {r.reply && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-muted">
            Owner replied{r.replyTime ? ` · ${format(r.replyTime, "MMM d, yyyy")}` : ""}
          </summary>
          <p className="mt-1 whitespace-pre-line border-l-2 pl-3 text-muted">{r.reply}</p>
        </details>
      )}
    </div>
  );
}
