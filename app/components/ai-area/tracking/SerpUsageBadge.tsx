"use client";

import type { SerpAccount } from "@/lib/providers/serpapi";

/**
 * "SerpApi 9 searches left" - SerpApi's own figure for the account behind this project's key. Account-wide: the
 * same key (and balance) may serve other projects, so it's never shown as this project's allocation.
 */
export function SerpUsageBadge({ account, unavailable }: { account: SerpAccount | null; unavailable?: string | null }) {
  const searchesLeft = account?.totalSearchesLeft ?? account?.planSearchesLeft ?? null;
  return (
    <span
      className="rounded-lg border px-2.5 py-1.5 text-xs whitespace-nowrap"
      style={{ borderColor: "var(--border-hairline)", color: "var(--text-secondary)", background: "var(--surface-1)" }}
      title={
        account
          ? `SerpApi account (${account.keySource === "project-legacy" ? "this project's legacy key" : account.keySource === "account" ? "your account key" : "server key"}): ${account.thisMonthUsage ?? "?"} used of ${account.searchesPerMonth ?? "?"} this month. Account-wide, shared by every project using this key. Checked ${new Date(account.fetchedAt).toLocaleString("en-GB")}.`
          : (unavailable ?? "SerpApi balance unavailable")
      }
    >
      SerpApi{" "}
      <strong className="tabular" style={{ color: "var(--text-primary)" }}>
        {searchesLeft != null ? searchesLeft.toLocaleString("en-US") : "–"}
      </strong>{" "}
      searches left (account)
    </span>
  );
}
