"use client";

import { useMemo, useState } from "react";
import type { SeKeyword, SeSnapshot } from "@/lib/seranking/donor/types";
import { Panel, Segmented, SelectControl } from "../ai-area/tracking/ui";
import { Move, PositionSpark, Th, fmtInt } from "./shared";

type Filter = "all" | "top3" | "top10" | "top30" | "notRanking" | "up" | "down";
type Sort = "position" | "change7" | "volume" | "keyword";
const PAGE = 50;

const FEATURE_LABEL: Record<string, string> = {
  sge: "AI Overview",
  ai_overview: "AI Overview",
  local_pack: "Local pack",
  people_also_ask: "People also ask",
  reviews: "Reviews",
  images: "Images",
  video: "Video",
  tads: "Top ads",
  bads: "Bottom ads",
  knowledge_graph: "Knowledge panel",
  sitelinks: "Sitelinks",
  gmb: "Business profile",
  featured_snippet: "Featured snippet",
};

function urlPath(link: string | null): string {
  if (!link) return "–";
  try {
    const u = new URL(link);
    return `${u.pathname}${u.search}` || "/";
  } catch {
    return link;
  }
}

export function RankingsSection({ snap }: { snap: SeSnapshot }) {
  const [engineId, setEngineId] = useState<string>(String(snap.engines[0]?.id ?? snap.keywords[0]?.engineId ?? ""));
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("position");
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(PAGE);

  const engineKeywords = useMemo(() => snap.keywords.filter((k) => String(k.engineId) === engineId), [snap.keywords, engineId]);
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const keep = (k: SeKeyword) => {
      if (term && !k.name.toLowerCase().includes(term) && !(k.landing ?? "").toLowerCase().includes(term)) return false;
      switch (filter) {
        case "top3":
          return k.current !== null && k.current <= 3;
        case "top10":
          return k.current !== null && k.current <= 10;
        case "top30":
          return k.current !== null && k.current <= 30;
        case "notRanking":
          return k.current === null;
        case "up":
          return (k.change7 ?? 0) > 0;
        case "down":
          return (k.change7 ?? 0) < 0;
        default:
          return true;
      }
    };
    const pos = (k: SeKeyword) => k.current ?? 1000;
    const cmp: Record<Sort, (a: SeKeyword, b: SeKeyword) => number> = {
      position: (a, b) => pos(a) - pos(b) || (b.volume ?? 0) - (a.volume ?? 0),
      change7: (a, b) => (b.change7 ?? -999) - (a.change7 ?? -999),
      volume: (a, b) => (b.volume ?? 0) - (a.volume ?? 0),
      keyword: (a, b) => a.name.localeCompare(b.name),
    };
    return engineKeywords.filter(keep).sort(cmp[sort]);
  }, [engineKeywords, filter, sort, search]);

  const dates = engineKeywords[0]?.positions.map((p) => p.date) ?? [];
  const lastDate = dates.at(-1);

  return (
    <Panel
      title="Keyword rankings"
      subtitle={`${fmtInt(rows.length)} of ${fmtInt(engineKeywords.length)} keywords${lastDate ? ` · checked ${lastDate}` : ""} · 30-day trend`}
      actions={
        snap.engines.length > 1 ? (
          <SelectControl
            ariaLabel="Search engine"
            value={engineId}
            onChange={(v) => {
              setEngineId(v);
              setShown(PAGE);
            }}
            options={snap.engines.map((e) => ({ value: String(e.id), label: `${e.name}${e.lang ? ` (${e.lang})` : ""}` }))}
          />
        ) : undefined
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setShown(PAGE);
          }}
          placeholder="Search keyword or URL"
          className="w-56 rounded-lg border px-2.5 py-1.5 text-xs outline-none"
          style={{ borderColor: "var(--border-hairline)", background: "var(--page-plane)", color: "var(--text-primary)" }}
        />
        <Segmented
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setShown(PAGE);
          }}
          ariaLabel="Filter keywords"
          options={[
            { value: "all", label: "All" },
            { value: "top3", label: "Top 3" },
            { value: "top10", label: "Top 10" },
            { value: "top30", label: "Top 30" },
            { value: "notRanking", label: "Not ranking" },
            { value: "up", label: "Up (7d)" },
            { value: "down", label: "Down (7d)" },
          ]}
        />
        <SelectControl
          ariaLabel="Sort by"
          value={sort}
          onChange={setSort}
          options={[
            { value: "position", label: "Sort: position" },
            { value: "change7", label: "Sort: 7-day change" },
            { value: "volume", label: "Sort: search volume" },
            { value: "keyword", label: "Sort: keyword" },
          ]}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-xs">
          <thead>
            <tr style={{ color: "var(--text-muted)" }}>
              <Th>Keyword</Th>
              <Th align="right">Position</Th>
              <Th>30 days</Th>
              <Th align="right">1d</Th>
              <Th align="right">7d</Th>
              <Th align="right">30d</Th>
              <Th align="right">Best</Th>
              <Th align="right">Volume</Th>
              <Th>Ranking URL</Th>
              <Th>SERP features</Th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((k) => (
              <tr key={k.id} className="border-t align-middle" style={{ borderColor: "var(--gridline)" }}>
                <td className="py-1.5 pr-3 font-medium" style={{ color: "var(--text-primary)" }}>
                  {k.name}
                </td>
                <td className="py-1.5 pr-3 text-right tabular text-sm font-semibold" style={{ color: k.current ? "var(--text-primary)" : "var(--text-muted)" }}>
                  {k.current ? k.current : "–"}
                </td>
                <td className="py-1.5 pr-3">
                  <PositionSpark positions={k.positions} />
                </td>
                <td className="py-1.5 pr-3 text-right tabular">
                  <Move value={k.change1} />
                </td>
                <td className="py-1.5 pr-3 text-right tabular">
                  <Move value={k.change7} />
                </td>
                <td className="py-1.5 pr-3 text-right tabular">
                  <Move value={k.change30} />
                </td>
                <td className="py-1.5 pr-3 text-right tabular" style={{ color: "var(--text-secondary)" }}>
                  {k.best ?? "–"}
                </td>
                <td className="py-1.5 pr-3 text-right tabular" style={{ color: "var(--text-secondary)" }}>
                  {fmtInt(k.volume)}
                </td>
                <td className="max-w-[16rem] truncate py-1.5 pr-3" title={k.landing ?? undefined}>
                  {k.landing ? (
                    <a href={k.landing} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: "var(--series-1)" }}>
                      {urlPath(k.landing)}
                    </a>
                  ) : (
                    <span style={{ color: "var(--text-muted)" }}>–</span>
                  )}
                </td>
                <td className="py-1.5 pr-3">
                  <span className="flex flex-wrap gap-1">
                    {k.features.slice(0, 4).map((f) => {
                      const own = k.ownFeatures.includes(f);
                      return (
                        <span
                          key={f}
                          className="whitespace-nowrap rounded px-1.5 py-0.5 text-[10px]"
                          style={{ background: own ? "color-mix(in srgb, var(--status-good) 16%, transparent)" : "var(--page-plane)", color: "var(--text-secondary)" }}
                          title={own ? "This feature links to your site" : "In the results page, not yours"}
                        >
                          {own ? "✓ " : ""}
                          {FEATURE_LABEL[f] ?? f.replace(/_/g, " ")}
                        </span>
                      );
                    })}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          No keywords match these filters.
        </p>
      ) : null}
      {shown < rows.length ? (
        <button type="button" onClick={() => setShown((n) => n + PAGE * 2)} className="self-center rounded-lg border px-3 py-1.5 text-xs font-medium" style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)" }}>
          Show more ({rows.length - shown} left)
        </button>
      ) : null}
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Changes are positions gained (▲) or lost (▼) since the previous check, 7 and 30 days ago; – means the keyword wasn&apos;t ranking on one of the dates.
      </p>
    </Panel>
  );
}
