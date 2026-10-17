"use client";

import { useMemo, useState } from "react";
import { LINK_PROFILE_CREDITS, type SeLinkDomain, type SeLinkProfile, type SeSnapshot } from "@/lib/seranking/donor/types";
import { formatShortDate } from "@/lib/ai-area/tracking/format";
import { Favicon } from "../ai-area/tracking/Favicon";
import { TrendChart } from "../ai-area/tracking/TrendChart";
import { ChartTableToggle, EmptyState, Headline, Panel, Segmented, type ChartView } from "../ai-area/tracking/ui";
import { NewLostChart, type NewLostRow } from "./charts";
import { BarList, SectionError, Th, fmtDate, fmtInt } from "./shared";

type Period = "90" | "30";
const DT_BANDS = ["0–9", "10–19", "20–29", "30–39", "40–49", "50–59", "60–69", "70–79", "80–89", "90–100"];

const regionNames = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();

function countryName(code: string): string {
  try {
    return regionNames?.of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

function flag(code: string): string {
  return /^[a-z]{2}$/i.test(code) ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "";
}

const pct = (part: number, total: number) => (total > 0 ? `${((part / total) * 100).toFixed(part / total < 0.1 ? 1 : 0)}%` : "–");

/** Daily new/lost counts as weekly bars (weeks start Monday), or the last 30 days day by day. */
function newLostRows(daily: SeLinkProfile["daily"], period: Period, kind: "links" | "domains"): NewLostRow[] {
  const gained = (d: SeLinkProfile["daily"][number]) => (kind === "links" ? d.newLinks : d.newDomains);
  const lost = (d: SeLinkProfile["daily"][number]) => (kind === "links" ? d.lostLinks : d.lostDomains);
  if (period === "30") {
    return daily.slice(-30).map((d) => ({ key: d.date, label: formatShortDate(d.date), title: fmtDate(d.date), gained: gained(d), lost: lost(d) }));
  }
  const weeks = new Map<string, { from: string; to: string; gained: number; lost: number }>();
  for (const d of daily) {
    const t = Date.parse(`${d.date}T00:00:00Z`);
    const monday = new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
    const w = weeks.get(monday) ?? { from: d.date, to: d.date, gained: 0, lost: 0 };
    w.to = d.date;
    w.gained += gained(d);
    w.lost += lost(d);
    weeks.set(monday, w);
  }
  return [...weeks.entries()].map(([monday, w]) => ({
    key: monday,
    label: formatShortDate(w.from),
    title: w.from === w.to ? fmtDate(w.from) : `${formatShortDate(w.from)} – ${fmtDate(w.to)}`,
    gained: w.gained,
    lost: w.lost,
  }));
}

function NewLost({ value, sign }: { value: number; sign: "+" | "−" }) {
  return (
    <span className="tabular font-medium" style={{ color: sign === "+" ? "var(--success-text)" : "var(--status-critical)" }}>
      {sign === "+" ? "▲ +" : "▼ −"}
      {fmtInt(value)}
    </span>
  );
}

function StatBlock({ label, value, sub, children }: { label: string; value: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      <div className="flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold tabular" style={{ color: "var(--text-primary)" }}>
          {value}
        </span>
        {sub ? (
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>
            {sub}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span>{children}</span>
    </div>
  );
}

/**
 * Host changes: the profile never refreshes on its own (Data API credits); `blockedReason` disables the refresh
 * button and says why (Preview, no credit budget, no Data API access), instead of letting a click fail.
 */
export function BacklinksSection({ snap, onRefresh, refreshing, blockedReason }: { snap: SeSnapshot; onRefresh: () => void; refreshing: boolean; blockedReason?: string | null }) {
  const lp = snap.linkProfile;
  const error = snap.errors.linkProfile;
  const refresh = (
    <button
      type="button"
      onClick={onRefresh}
      disabled={refreshing || Boolean(blockedReason)}
      className="rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-60"
      style={{ borderColor: "var(--border-hairline)", color: "var(--text-primary)", background: "var(--surface-1)" }}
      title={blockedReason ?? `Pulls fresh backlink data from SE Ranking - uses about ${fmtInt(LINK_PROFILE_CREDITS)} SE Ranking API credits`}
    >
      {refreshing ? "Refreshing..." : "Refresh backlinks"}
    </button>
  );

  if (!lp) {
    return (
      <div className="flex flex-col gap-4">
        {error ? <SectionError message={error} /> : null}
        <EmptyState
          title="No backlink data yet"
          body={
            error
              ? "SE Ranking's backlink index is part of its Data API, which runs on API credits. Check that the account's API plan includes Data API credits, then refresh."
              : `Backlink profiles come from SE Ranking's Data API and use about ${fmtInt(LINK_PROFILE_CREDITS)} API credits per refresh, so they only refresh when you ask.${blockedReason ? ` Refresh unavailable: ${blockedReason}` : ""}`
          }
          action={refresh}
        />
        <MonitorPanel snap={snap} />
      </div>
    );
  }
  return <Profile lp={lp} snap={snap} error={error} refresh={refresh} />;
}

function Profile({ lp, snap, error, refresh }: { lp: SeLinkProfile; snap: SeSnapshot; error?: string; refresh: React.ReactNode }) {
  const [period, setPeriod] = useState<Period>("90");
  const [domainsView, setDomainsView] = useState<ChartView>("chart");
  const [linksView, setLinksView] = useState<ChartView>("chart");
  const [totalView, setTotalView] = useState<ChartView>("chart");
  const [trustView, setTrustView] = useState<ChartView>("chart");
  const partErrors = Object.entries(lp.errors);

  const totals = useMemo(() => lp.daily.filter((d) => d.total !== null), [lp.daily]);
  const domainRows = useMemo(() => newLostRows(lp.daily, period, "domains"), [lp.daily, period]);
  const linkRows = useMemo(() => newLostRows(lp.daily, period, "links"), [lp.daily, period]);
  const bandTotal = lp.dtBands.reduce((a, b) => a + b, 0);
  const countryTotal = lp.countries.reduce((a, c) => a + c.count, 0);
  const trustStart = lp.trust.find((t) => t.dt !== null)?.dt ?? null;
  const dofollowShare = lp.backlinks ? lp.dofollow / lp.backlinks : null;
  const competitors = lp.compare.filter((c) => !c.isOwn);
  const periodLabel = period === "90" ? "per week, last 3 months" : "per day, last 30 days";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          SE Ranking backlink index for {lp.target}
          {lp.mode === "domain" ? " (all subdomains)" : ""} · updated {fmtDate(lp.fetchedAt)} · refreshes weekly
        </span>
        {refresh}
      </div>
      <SectionError message={error ? `${error} (showing the data from ${fmtDate(lp.fetchedAt)})` : undefined} />
      {partErrors.length ? <SectionError message={partErrors.map(([k, v]) => `${k}: ${v}`).join(" · ")} /> : null}

      <section
        className="grid grid-cols-1 gap-x-8 gap-y-6 rounded-xl border p-4 sm:grid-cols-2 xl:grid-cols-4"
        style={{ borderColor: "var(--border-hairline)", background: "var(--surface-1)" }}
        aria-label="Backlink profile"
      >
        <div className="flex flex-col gap-4">
          <StatBlock label="Domain Trust" value={fmtInt(lp.domainTrust)} sub="/100">
            {trustStart !== null && lp.domainTrust !== null && lp.trust.length > 1 ? (
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {lp.domainTrust - trustStart === 0 ? "unchanged" : `${lp.domainTrust - trustStart > 0 ? "▲ +" : "▼ −"}${Math.abs(lp.domainTrust - trustStart)}`} in 6 months
              </span>
            ) : null}
          </StatBlock>
          <StatBlock label="Page Trust" value={fmtInt(lp.pageTrust)} sub="/100" />
        </div>
        <StatBlock label="Referring domains" value={fmtInt(lp.refDomains)}>
          <Row label="New in last 30 days">
            <NewLost value={lp.new30.refDomains} sign="+" />
          </Row>
          <Row label="Lost in last 30 days">
            <NewLost value={lp.lost30.refDomains} sign="−" />
          </Row>
          <Row label="With a dofollow link">
            <span className="tabular" style={{ color: "var(--text-primary)" }}>
              {fmtInt(lp.dofollowRefDomains)}
            </span>
          </Row>
        </StatBlock>
        <StatBlock label="Backlinks" value={fmtInt(lp.backlinks)}>
          <Row label="New in last 30 days">
            <NewLost value={lp.new30.backlinks} sign="+" />
          </Row>
          <Row label="Lost in last 30 days">
            <NewLost value={lp.lost30.backlinks} sign="−" />
          </Row>
          <Row label="Pages linked to">
            <span className="tabular" style={{ color: "var(--text-primary)" }}>
              {fmtInt(lp.pagesWithBacklinks)}
            </span>
          </Row>
        </StatBlock>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
            Link types
          </span>
          {dofollowShare !== null ? (
            <div className="flex flex-col gap-1">
              <div className="flex h-2.5 overflow-hidden rounded" role="img" aria-label={`${Math.round(dofollowShare * 100)}% dofollow`}>
                <span style={{ width: `${dofollowShare * 100}%`, background: "var(--series-1)" }} />
                <span style={{ width: 2, background: "var(--surface-1)" }} />
                <span className="flex-1" style={{ background: "var(--meter-track)" }} />
              </div>
              <div className="flex justify-between text-xs" style={{ color: "var(--text-secondary)" }}>
                <span>
                  <span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: "var(--series-1)" }} />
                  Dofollow {fmtInt(lp.dofollow)}
                </span>
                <span>
                  <span aria-hidden className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: "var(--meter-track)" }} />
                  Nofollow {fmtInt(lp.nofollow)}
                </span>
              </div>
            </div>
          ) : null}
          <Row label="Text links">
            <span className="tabular" style={{ color: "var(--text-primary)" }}>
              {fmtInt(lp.textBacklinks)}
            </span>
          </Row>
          <Row label="From home pages">
            <span className="tabular" style={{ color: "var(--text-primary)" }}>
              {fmtInt(lp.fromHomePages)}
            </span>
          </Row>
          <Row label=".edu / .gov links">
            <span className="tabular" style={{ color: "var(--text-primary)" }}>
              {fmtInt(lp.edu)} / {fmtInt(lp.gov)}
            </span>
          </Row>
          <Row label="Referring IPs / subnets">
            <span className="tabular" style={{ color: "var(--text-primary)" }}>
              {fmtInt(lp.ips)} / {fmtInt(lp.subnets)}
            </span>
          </Row>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Total backlinks" subtitle="live backlinks per day, last 3 months" actions={<ChartTableToggle view={totalView} onChange={setTotalView} />}>
          {totals.length > 1 ? (
            <TrendChart
              dates={totals.map((d) => d.date)}
              series={[{ id: "total", label: "Backlinks", color: "var(--series-1)", values: totals.map((d) => d.total), directLabel: true }]}
              format={(v) => fmtInt(v)}
              view={totalView}
              ariaLabel="Total backlinks over time"
            />
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              No history returned.
            </p>
          )}
        </Panel>
        <Panel title="Domain Trust and Page Trust" subtitle="weekly, last 6 months · 0–100" actions={<ChartTableToggle view={trustView} onChange={setTrustView} />}>
          {lp.trust.length > 1 ? (
            <TrendChart
              dates={lp.trust.map((t) => t.date)}
              series={[
                { id: "dt", label: "Domain Trust", color: "var(--series-1)", values: lp.trust.map((t) => t.dt) },
                { id: "pt", label: "Page Trust (home page)", color: "var(--series-2)", values: lp.trust.map((t) => t.pt) },
              ]}
              format={(v) => String(Math.round(v))}
              maxDomain={100}
              view={trustView}
              ariaLabel="Domain Trust and Page Trust over time"
            />
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              No history returned.
            </p>
          )}
        </Panel>
      </div>

      <div className="flex justify-end">
        <Segmented
          value={period}
          onChange={setPeriod}
          ariaLabel="Period"
          options={[
            { value: "90", label: "3 months, weekly" },
            { value: "30", label: "30 days, daily" },
          ]}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="New & lost referring domains" subtitle={periodLabel} actions={<ChartTableToggle view={domainsView} onChange={setDomainsView} />}>
          <NewLostChart rows={domainRows} unit="referring domains" view={domainsView} />
        </Panel>
        <Panel title="New & lost backlinks" subtitle={periodLabel} actions={<ChartTableToggle view={linksView} onChange={setLinksView} />}>
          <NewLostChart rows={linkRows} unit="backlinks" view={linksView} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Panel title="Top anchor texts" subtitle="by backlinks">
          {lp.anchors.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ color: "var(--text-muted)" }}>
                    <Th>Anchor text</Th>
                    <Th align="right">Backlinks</Th>
                    <Th align="right">%</Th>
                    <Th align="right">Domains</Th>
                  </tr>
                </thead>
                <tbody>
                  {lp.anchors.slice(0, 12).map((a, i) => (
                    <tr key={`${a.anchor}-${i}`} className="border-t" style={{ borderColor: "var(--gridline)" }}>
                      <td className="max-w-[12rem] truncate py-1.5 pr-3" style={{ color: a.anchor ? "var(--text-primary)" : "var(--text-muted)" }} title={a.anchor || "No anchor text (image or empty link)"}>
                        {a.anchor || "(no text)"}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular" style={{ color: "var(--text-primary)" }}>
                        {fmtInt(a.backlinks)}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular" style={{ color: "var(--text-secondary)" }}>
                        {pct(a.backlinks, lp.backlinks)}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular" style={{ color: "var(--text-secondary)" }}>
                        {fmtInt(a.refDomains)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              No anchors returned.
            </p>
          )}
          {lp.anchorCount ? (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {fmtInt(lp.anchorCount)} different anchor texts in all.
            </p>
          ) : null}
        </Panel>
        <Panel title="Domains by Domain Trust" subtitle="referring domains per Domain Trust band">
          {bandTotal > 0 ? (
            <BarList format={(v) => `${fmtInt(v)} · ${pct(v, bandTotal)}`} rows={DT_BANDS.map((label, i) => ({ key: label, label: `DT ${label}`, value: lp.dtBands[i] }))} />
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              No distribution returned.
            </p>
          )}
          {bandTotal > 0 ? (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {pct(lp.dtBands.slice(5).reduce((a, b) => a + b, 0), bandTotal)} of referring domains have a Domain Trust of 50 or more.
            </p>
          ) : null}
        </Panel>
        <Panel title="Countries" subtitle="where the backlinks come from">
          {lp.countries.length ? (
            <BarList
              format={(v) => `${fmtInt(v)} · ${pct(v, countryTotal)}`}
              rows={lp.countries.slice(0, 10).map((c) => ({
                key: c.code,
                label: (
                  <span>
                    <span aria-hidden className="mr-1.5">
                      {flag(c.code)}
                    </span>
                    {countryName(c.code)}
                  </span>
                ),
                value: c.count,
              }))}
            />
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              No countries returned.
            </p>
          )}
          {lp.tlds.length ? (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Top domain endings: {lp.tlds.slice(0, 5).map((t) => `.${t.tld} (${fmtInt(t.count)})`).join(", ")}
            </p>
          ) : null}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <DomainList title="Referring domains won" subtitle="first linked in the last 30 days" rows={lp.newDomains} empty="No new referring domains in the last 30 days." />
        <DomainList title="Referring domains lost" subtitle="stopped linking in the last 30 days" rows={lp.lostDomains} empty="No referring domains lost in the last 30 days." />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Against your competitors" subtitle="tracked competitors in the SE Ranking project">
          {competitors.length ? (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
              {(
                [
                  ["Referring domains", "refDomains"],
                  ["Backlinks", "backlinks"],
                  ["Domain Trust", "domainTrust"],
                ] as const
              ).map(([label, key]) => (
                <div key={key} className="flex flex-col gap-2">
                  <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                    {label}
                  </span>
                  <BarList
                    max={key === "domainTrust" ? 100 : undefined}
                    rows={[...lp.compare]
                      .sort((a, b) => (b[key] ?? -1) - (a[key] ?? -1))
                      .map((c) => ({
                        key: c.domain,
                        label: (
                          <span style={{ fontWeight: c.isOwn ? 600 : undefined, color: c.isOwn ? "var(--text-primary)" : undefined }}>
                            {c.domain}
                            {c.isOwn ? " (you)" : ""}
                          </span>
                        ),
                        value: c[key] ?? 0,
                        color: c.isOwn ? "var(--series-1)" : "var(--text-muted)",
                      }))}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Add competitors to the SE Ranking project to compare backlink profiles.
            </p>
          )}
        </Panel>
        <Panel title="Most linked pages" subtitle="your pages with the most referring domains">
          {lp.topPages.length ? (
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: "var(--text-muted)" }}>
                  <Th>Page</Th>
                  <Th align="right">Ref. domains</Th>
                  <Th align="right">Backlinks</Th>
                </tr>
              </thead>
              <tbody>
                {lp.topPages.map((p) => (
                  <tr key={p.url} className="border-t" style={{ borderColor: "var(--gridline)" }}>
                    <td className="max-w-[18rem] truncate py-1.5 pr-3" title={p.url}>
                      <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: "var(--series-1)" }}>
                        {p.url.replace(/^https?:\/\/(www\.)?/, "")}
                      </a>
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular" style={{ color: "var(--text-primary)" }}>
                      {fmtInt(p.refDomains)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular" style={{ color: "var(--text-secondary)" }}>
                      {fmtInt(p.backlinks)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              No pages returned.
            </p>
          )}
        </Panel>
      </div>
      <MonitorPanel snap={snap} />
    </div>
  );
}

function DomainList({ title, subtitle, rows, empty }: { title: string; subtitle: string; rows: SeLinkDomain[]; empty: string }) {
  return (
    <Panel title={title} subtitle={subtitle}>
      {rows.length ? (
        <table className="w-full text-xs">
          <thead>
            <tr style={{ color: "var(--text-muted)" }}>
              <Th>Domain</Th>
              <Th align="right">DT</Th>
              <Th align="right">Backlinks</Th>
              <Th align="right">Date</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={`${d.domain}-${d.date}`} className="border-t" style={{ borderColor: "var(--gridline)" }}>
                <td className="max-w-[14rem] py-1.5 pr-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <Favicon domain={d.domain} size={14} />
                    <a href={`https://${d.domain}`} target="_blank" rel="noreferrer" className="truncate hover:underline" style={{ color: "var(--text-primary)" }}>
                      {d.domain}
                    </a>
                  </span>
                </td>
                <td className="py-1.5 pr-3 text-right tabular" style={{ color: "var(--text-primary)" }}>
                  {fmtInt(d.dt)}
                </td>
                <td className="py-1.5 pr-3 text-right tabular" style={{ color: "var(--text-secondary)" }} title={d.dofollow !== null ? `${fmtInt(d.dofollow)} dofollow` : undefined}>
                  {fmtInt(d.backlinks)}
                </td>
                <td className="whitespace-nowrap py-1.5 pr-3 text-right" style={{ color: "var(--text-secondary)" }}>
                  {formatShortDate(d.date)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {empty}
        </p>
      )}
    </Panel>
  );
}

/** Links tracked by hand in SE Ranking's Backlink Monitor - shown only when the project uses it. */
function MonitorPanel({ snap }: { snap: SeSnapshot }) {
  const b = snap.backlinks;
  if (!b || b.total <= 0) return null;
  return (
    <Panel title="Backlink Monitor" subtitle="links you track in SE Ranking's Backlink Monitor">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-6">
        <Headline label="Backlinks" value={fmtInt(b.total)} />
        <Headline label="Referring domains" value={fmtInt(b.domains)} />
        <Headline label="Dofollow" value={fmtInt(b.dofollow)} />
        <Headline label="Nofollow" value={fmtInt(b.nofollow)} />
        <Headline label="Anchors" value={fmtInt(b.anchors)} />
        <Headline label="IP addresses" value={fmtInt(b.ip)} />
      </div>
    </Panel>
  );
}
