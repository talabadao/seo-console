// Pure helpers for turning a website URL into project defaults (brand name,
// favicon, the matching Search Console / GA4 property). No server imports —
// shared by the project form in the browser and the one-time seeding on the
// server.

/** Hostname of a URL, a bare domain, or a Search Console property id. */
export function hostOf(input: string): string {
  const raw = input.trim().replace(/^sc-domain:/i, "");
  if (!raw) return "";
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

const bare = (host: string) => host.replace(/^www\./, "");

/** "example.com/shop" → "https://example.com/shop"; "" when it isn't a usable URL. */
export function normalizeUrl(input: string): string {
  const raw = input.trim();
  if (!raw || !hostOf(raw)) return "";
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/** Favicon served by Google's favicon service — no fetch of the site needed. */
export function faviconFor(host: string): string {
  return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64` : "";
}

const SECOND_LEVEL = new Set(["co", "com", "net", "org", "gov", "edu", "ac"]);

/** The registrable name of a host: "blog.kin-hotel.com.vn" → "kin-hotel". */
export function coreLabel(host: string): string {
  const labels = bare(host).split(".").filter(Boolean);
  if (labels.length > 1) labels.pop();
  if (labels.length > 1 && SECOND_LEVEL.has(labels[labels.length - 1])) labels.pop();
  return labels[labels.length - 1] ?? "";
}

/** A readable default brand name: "kin-hotel" → "Kin Hotel". */
export function brandFromHost(host: string): string {
  return coreLabel(host)
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** Best Search Console property for a host: a domain property first, then an exact URL prefix. */
export function matchGsc(host: string, properties: string[]): string | null {
  const h = bare(host);
  if (!h) return null;
  let best: { property: string; score: number } | null = null;
  for (const property of properties) {
    const ph = bare(hostOf(property));
    if (!ph) continue;
    const isDomain = property.startsWith("sc-domain:");
    let score = 0;
    if (ph === h) score = isDomain ? 4 : property.startsWith("https://") ? 3 : 2;
    else if (isDomain && h.endsWith(`.${ph}`)) score = 1;
    if (score > (best?.score ?? 0)) best = { property, score };
  }
  return best?.property ?? null;
}

/** URL-safe form of a name: "KiN Hotel & Spa" → "kin-hotel-spa". */
export function slugify(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"
  );
}

/** A project's address segment: its name, plus its id when two projects share a name. */
export function projectSlug(project: { id: number; name: string }, all: { id: number; name: string }[]): string {
  const base = slugify(project.name);
  return all.some((p) => p.id !== project.id && slugify(p.name) === base) ? `${base}-${project.id}` : base;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** GA4 property whose display name mentions the host's registrable name, if any. */
export function matchGa(
  host: string,
  gaProperties: { propertyId: string; displayName: string | null }[],
): string | null {
  const core = norm(coreLabel(host));
  if (core.length < 3) return null;
  const hits = gaProperties
    .filter((p) => norm(p.displayName ?? "").includes(core))
    .sort((a, b) => (a.displayName ?? "").length - (b.displayName ?? "").length);
  return hits[0]?.propertyId ?? null;
}
