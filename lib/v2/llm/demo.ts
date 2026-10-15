// Invented LLMs Traffic for demo projects and local mock mode. Always shown with a Demo label.

import { DEFAULT_AI_DOMAINS } from "@/lib/ga4";
import { addDaysYmd, daysBetween } from "@/lib/v2/summary/period";
import type { PeriodInfo } from "@/lib/v2/summary/types";
import { platformOf } from "./platforms";
import type { Granularity, LlmMetric, LlmReport } from "./report";

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const SHARES: [string, number][] = [
  ["chatgpt.com", 0.9],
  ["gemini.google.com", 0.04],
  ["copilot.microsoft.com", 0.025],
  ["perplexity.ai", 0.02],
  ["claude.ai", 0.015],
];

export function demoLlmReport(
  id: number,
  period: PeriodInfo,
  metric: LlmMetric,
  granularity: Granularity,
  platformFilter: string,
): LlmReport {
  const r = rng(id * 7919 + 13);
  const days = daysBetween(period.current.start, period.current.end);
  const base = 8 + r() * 20; // sessions per day
  const userRatio = 0.82;
  const platforms = SHARES.map(([d, share]) => {
    const p = platformOf(d, DEFAULT_AI_DOMAINS)!;
    const sessions = Math.round(base * days * share);
    const value =
      metric === "users" ? Math.round(sessions * userRatio) : sessions;
    return {
      ...p,
      sessions,
      value: {
        current: value,
        previous: period.previous
          ? Math.round(value / (0.7 + r() * 0.7))
          : null,
      },
    };
  });
  const totalSessions = platforms.reduce((a, p) => a + p.sessions, 0);
  // Users overlap between platforms in reality, so the demo total is a little below the sum.
  const total =
    metric === "users"
      ? {
          current: Math.round(
            platforms.reduce((a, p) => a + (p.value.current ?? 0), 0) * 0.97,
          ),
          previous: null,
        }
      : {
          current: totalSessions,
          previous: period.previous
            ? platforms.reduce((a, p) => a + (p.value.previous ?? 0), 0)
            : null,
        };
  const shown =
    platformFilter === "all"
      ? platforms
      : platforms.filter((p) => p.id === platformFilter);
  const step = granularity === "day" ? 1 : granularity === "week" ? 7 : 30;
  const buckets: string[] = [];
  for (let i = 0; i < days; i += step) {
    const d = addDaysYmd(period.current.start, i);
    buckets.push(
      granularity === "month"
        ? d.slice(0, 7)
        : granularity === "week"
          ? `${d.slice(0, 4)}-W${String(Math.ceil(i / 7) + 1).padStart(2, "0")}`
          : d,
    );
  }
  const uniq = [...new Set(buckets)];
  const filteredSessions = shown.reduce((a, p) => a + p.sessions, 0);
  const scale = metric === "users" ? userRatio : 1;
  const list = (keys: [string, number][]) => {
    const rows = keys.map(([key, w]) => ({
      key,
      value: Math.round(filteredSessions * w * scale),
    }));
    return { rows, total: Math.round(filteredSessions * scale) };
  };
  return {
    metric,
    metricLabel: metric === "users" ? "Users (GA4 active users)" : "Sessions",
    platformFilter,
    timeZone: "Asia/Ho_Chi_Minh",
    period,
    aiDomains: DEFAULT_AI_DOMAINS,
    platforms: platforms.map(({ sessions: _s, ...p }) => p),
    total,
    share:
      metric === "sessions"
        ? platforms.map((p) => ({
            id: p.id,
            name: p.name,
            color: p.color,
            sessions: p.sessions,
            pct: totalSessions ? (p.sessions / totalSessions) * 100 : 0,
          }))
        : null,
    trend: {
      granularity,
      buckets: uniq,
      series: shown.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        values: uniq.map(() =>
          Math.max(
            0,
            Math.round(
              ((p.sessions * scale) / uniq.length) * (0.6 + r() * 0.8),
            ),
          ),
        ),
      })),
    },
    engagement: platforms.map((p) => {
      const duration = 60 + r() * 240;
      return {
        id: p.id,
        name: p.name,
        color: p.color,
        sessions: p.sessions,
        engagementRate: 0.45 + r() * 0.3,
        avgSessionDuration: duration,
        // Engagement time is foreground time only, so it never exceeds the session duration.
        avgEngagementTimePerSession: duration * (0.4 + r() * 0.4),
        pagesPerSession: 1 + r() * 2.5,
        bounceRate: 0.25 + r() * 0.4,
      };
    }),
    landingPages: [
      "/",
      "/rooms/ocean-suite/",
      "/offers/spring-escape/",
      "/dining/",
      "/blog/things-to-do-nearby/",
      "(not set)",
    ].flatMap((page, i) =>
      shown.slice(0, 2).map((p, j) => ({
        platform: { id: p.id, name: p.name, color: p.color },
        page,
        sessions: Math.max(
          1,
          Math.round((p.sessions / (i + 2)) * (j ? 0.3 : 1)),
        ),
        avgSessionDuration: page === "(not set)" ? 3 : 90 + r() * 200,
        bounceRate: page === "(not set)" ? 0.97 : 0.2 + r() * 0.4,
      })),
    ),
    countries: list([
      ["Vietnam", 0.35],
      ["Australia", 0.12],
      ["Singapore", 0.06],
      ["United States", 0.06],
      ["Japan", 0.05],
      ["(not set)", 0.01],
    ]),
    cities: list([
      ["Ho Chi Minh City", 0.23],
      ["Hanoi", 0.05],
      ["Singapore", 0.05],
      ["Melbourne", 0.04],
      ["Sydney", 0.03],
      ["(not set)", 0.08],
    ]),
    browsers: list([
      ["Safari", 0.52],
      ["Chrome", 0.39],
      ["Edge", 0.05],
      ["Samsung Internet", 0.02],
      ["Firefox", 0.01],
    ]),
    devices: list([
      ["mobile", 0.58],
      ["desktop", 0.41],
      ["tablet", 0.01],
    ]),
    heatmap: Array.from({ length: 7 * 24 }, (_, i) => {
      const day = Math.floor(i / 24);
      const hour = i % 24;
      const daytime = hour >= 8 && hour <= 22 ? 1 : 0.15;
      return { day, hour, value: Math.round(daytime * (r() * 6)) };
    }),
    sampled: false,
    fetchedAt: Date.now(),
  };
}
