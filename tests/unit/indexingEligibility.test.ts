import { describe, expect, it } from "vitest";
import { eligibleTypesIn, urlBelongsToProperty } from "@/lib/indexingEligibility";

const ld = (data: unknown) => `<html><head><script type="application/ld+json">${JSON.stringify(data)}</script></head></html>`;

describe("eligibleTypesIn", () => {
  it("finds JobPosting in JSON-LD, including inside @graph and with array types", () => {
    expect(eligibleTypesIn(ld({ "@context": "https://schema.org", "@type": "JobPosting", title: "Chef" }))).toEqual([
      "JobPosting",
    ]);
    expect(eligibleTypesIn(ld({ "@graph": [{ "@type": "WebPage" }, { "@type": ["JobPosting", "Thing"] }] }))).toEqual([
      "JobPosting",
    ]);
  });

  it("accepts a livestream only as a VideoObject whose publication is a BroadcastEvent", () => {
    const live = { "@type": "VideoObject", name: "Live", publication: { "@type": "BroadcastEvent", isLiveBroadcast: true } };
    expect(eligibleTypesIn(ld(live))).toEqual(["BroadcastEvent"]);
    expect(eligibleTypesIn(ld({ "@type": "BroadcastEvent" }))).toEqual([]);
    expect(eligibleTypesIn(ld({ "@type": "VideoObject", name: "Recorded" }))).toEqual([]);
  });

  it("finds microdata JobPosting", () => {
    expect(eligibleTypesIn('<div itemscope itemtype="https://schema.org/JobPosting"><h1 itemprop="title">Chef</h1></div>')).toEqual([
      "JobPosting",
    ]);
  });

  it("does not infer eligibility from the URL, title or ordinary markup", () => {
    expect(eligibleTypesIn(ld({ "@type": "Article", headline: "We are hiring: JobPosting tips" }))).toEqual([]);
    expect(eligibleTypesIn("<html><body><h1>Careers</h1><p>JobPosting</p></body></html>")).toEqual([]);
    expect(eligibleTypesIn(ld({ "@type": "Hotel", name: "Example Hotel" }))).toEqual([]);
  });

  it("ignores malformed JSON-LD blocks instead of failing", () => {
    const html = `<script type="application/ld+json">{ not json </script>${ld({ "@type": "JobPosting" })}`;
    expect(eligibleTypesIn(html)).toEqual(["JobPosting"]);
  });
});

describe("urlBelongsToProperty", () => {
  it("allows the domain and its subdomains for a domain property", () => {
    expect(urlBelongsToProperty("https://example.com/jobs/1", "sc-domain:example.com")).toBe(true);
    expect(urlBelongsToProperty("https://careers.example.com/1", "sc-domain:example.com")).toBe(true);
    expect(urlBelongsToProperty("https://example.com.evil.io/1", "sc-domain:example.com")).toBe(false);
  });

  it("requires the same host for a URL-prefix property", () => {
    expect(urlBelongsToProperty("https://www.example.com/a", "https://www.example.com/")).toBe(true);
    expect(urlBelongsToProperty("https://shop.example.com/a", "https://www.example.com/")).toBe(false);
  });

  it("refuses non-web schemes and garbage", () => {
    expect(urlBelongsToProperty("file:///etc/passwd", "sc-domain:example.com")).toBe(false);
    expect(urlBelongsToProperty("not a url", "sc-domain:example.com")).toBe(false);
  });
});
