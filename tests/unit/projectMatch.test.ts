import { describe, expect, it } from "vitest";
import {
  brandFromHost,
  coreLabel,
  hostOf,
  matchGa,
  matchGsc,
  normalizeUrl,
  projectSlug,
  slugify,
} from "@/lib/projectMatch";

describe("hostOf / normalizeUrl", () => {
  it("reads hosts from URLs, bare domains and Search Console ids", () => {
    expect(hostOf("sc-domain:kinhotel.com")).toBe("kinhotel.com");
    expect(hostOf("https://www.Kinhotel.com/a")).toBe("www.kinhotel.com");
    expect(hostOf("kinhotel.com")).toBe("kinhotel.com");
    expect(hostOf("not a url")).toBe("");
  });
  it("adds https only to usable addresses", () => {
    expect(normalizeUrl("kinhotel.com/x")).toBe("https://kinhotel.com/x");
    expect(normalizeUrl("   ")).toBe("");
  });
});

describe("brand and property matching", () => {
  it("derives the registrable name", () => {
    expect(coreLabel("blog.kin-hotel.com.vn")).toBe("kin-hotel");
    expect(brandFromHost("www.pullman-phuquoc.com")).toBe("Pullman Phuquoc");
  });

  const gsc = [
    "sc-domain:kinhotel.com",
    "https://www.kinhotel.com/",
    "https://pullman-phuquoc.com/",
    "sc-domain:example.vn",
  ];
  it("prefers a domain property, then an exact URL prefix", () => {
    expect(matchGsc("www.kinhotel.com", gsc)).toBe("sc-domain:kinhotel.com");
    expect(matchGsc("pullman-phuquoc.com", gsc)).toBe("https://pullman-phuquoc.com/");
    expect(matchGsc("shop.example.vn", gsc)).toBe("sc-domain:example.vn");
    expect(matchGsc("nomatch.io", gsc)).toBeNull();
  });

  it("matches GA4 properties by name and returns null when unsure", () => {
    const ga = [
      { propertyId: "1", displayName: "KiN Hotel Group - GA4" },
      { propertyId: "3", displayName: "Kinhotel" },
    ];
    expect(matchGa("kinhotel.com", ga)).toBe("3");
    expect(matchGa("zzz.com", ga)).toBeNull();
  });
});

describe("project address slugs", () => {
  it("strips accents and punctuation", () => {
    expect(slugify("Rượu Vang WeWine")).toBe("ruou-vang-wewine");
    expect(slugify("KiN Hotel & Spa")).toBe("kin-hotel-spa");
    expect(slugify("酒店")).toBe("project");
  });
  it("adds the id only when two projects share a slug", () => {
    const all = [
      { id: 1, name: "KiN Hotel & Spa" },
      { id: 3, name: "kin hotel spa" },
      { id: 2, name: "WeWine" },
    ];
    expect(projectSlug(all[0], all)).toBe("kin-hotel-spa-1");
    expect(projectSlug(all[1], all)).toBe("kin-hotel-spa-3");
    expect(projectSlug(all[2], all)).toBe("wewine");
  });
});
