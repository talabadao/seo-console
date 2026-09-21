"use client";

/**
 * Sentinel value for the "AI (custom domain list)" channel filter option —
 * not a real GA4 sessionDefaultChannelGroup value. GA4's own "AI Assistant"
 * channel grouping is unreliable, so this app classifies AI traffic itself
 * via the AI-source domain list in Settings (same logic as the main
 * Analytics chart's Organic/AI/Other split) instead of trusting GA4's bucket.
 * Mirrors lib/gaChannels.ts's AI_CHANNEL constant — kept as a plain string
 * literal here too so this file stays a pure client component.
 */
export const AI_CHANNEL = "__ai__";

export function ChannelSelect({
  channels,
  value,
  onChange,
}: {
  channels: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border bg-background px-2 py-1.5 text-sm"
      title="AI uses this app's own AI-source domain list (Settings), not GA4's own AI Assistant channel"
    >
      <option value="">All channels</option>
      <option value={AI_CHANNEL}>AI (custom domain list)</option>
      {channels.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}
