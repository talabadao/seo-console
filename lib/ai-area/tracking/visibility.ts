import type { AiTextSnapshot, BrandHit, OrganicResultSnapshot, TrackedBrand } from "./types";

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

// Every tracked result x every brand x every day means the same few name patterns get tested
// hundreds of thousands of times, so compile each once.
const namePatterns = new Map<string, RegExp>();

function textMentionsName(text: string, name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  let pattern = namePatterns.get(trimmed);
  if (!pattern) {
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    pattern = new RegExp(`\\b${escaped}\\b`, "i");
    namePatterns.set(trimmed, pattern);
  }
  return pattern.test(text);
}

function domainMatches(domain: string, website: string): boolean {
  if (!website.trim() || !domain) return false;
  const site = normalize(website).replace(/^www\./, "");
  return domain === site || domain.endsWith(`.${site}`);
}

export function isGoogleHost(domain: string): boolean {
  return /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(domain) || domain === "g.co" || domain.endsWith("goo.gl");
}

export function computeOrganicHit(results: OrganicResultSnapshot[], brand: TrackedBrand): BrandHit {
  const names = [brand.name, ...brand.aliases].filter(Boolean);
  for (const r of results) {
    if (brand.website && domainMatches(r.domain, brand.website)) {
      return { matched: true, matchedBy: ["website"], organicPosition: r.position };
    }
    for (const name of names) {
      if (textMentionsName(`${r.title} ${r.snippet}`, name)) {
        return {
          matched: true,
          matchedBy: [name === brand.name ? "name" : "alias"],
          organicPosition: r.position,
        };
      }
    }
  }
  return { matched: false, matchedBy: [], organicPosition: null };
}

export function computeAiHit(snapshot: AiTextSnapshot, brand: TrackedBrand): BrandHit {
  const matchedBy = new Set<"name" | "alias" | "website">();
  const names = [brand.name, ...brand.aliases].filter(Boolean);

  if (snapshot.text) {
    for (const name of names) {
      if (textMentionsName(snapshot.text, name)) {
        matchedBy.add(name === brand.name ? "name" : "alias");
      }
    }
  }
  const cited = snapshot.sources.some(
    (s) =>
      (brand.website && domainMatches(s.domain, brand.website)) ||
      // A Google-hosted source (Business Profile, Maps) titled with the brand is a citation of the brand.
      (isGoogleHost(s.domain) && names.some((name) => textMentionsName(s.title, name)))
  );
  if (cited) matchedBy.add("website");

  return { matched: matchedBy.size > 0, matchedBy: Array.from(matchedBy), organicPosition: null };
}
