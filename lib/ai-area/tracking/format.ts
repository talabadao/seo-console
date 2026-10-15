export function formatShortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function formatWeekday(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

export function formatPct(ratio: number): string {
  const v = Math.round(ratio * 1000) / 10;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
}

export function formatPosition(position: number): string {
  return `#${Number.isInteger(position) ? position : position.toFixed(1)}`;
}

export function formatCount(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(1);
}

export function urlPath(link: string): string {
  try {
    const u = new URL(link);
    return `${u.pathname}${u.search}` || "/";
  } catch {
    return link;
  }
}

export function trendTitle(halfDays: number): string | undefined {
  return halfDays > 0 ? `Last ${halfDays} tracked day${halfDays === 1 ? "" : "s"} vs the ${halfDays} before` : undefined;
}
