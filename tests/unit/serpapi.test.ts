import { describe, expect, it } from "vitest";
import { creditsFor, normalizeMapsUrl, placeRefFromUrl } from "@/lib/serpapi";

describe("creditsFor", () => {
  it("charges 1 credit for the first 8 reviews, then 1 per 20", () => {
    expect([0, 1, 8, 9, 28, 29, 130, 200].map(creditsFor)).toEqual([0, 1, 1, 2, 2, 3, 8, 11]);
  });
});

describe("placeRefFromUrl", () => {
  it("reads a data id from a full Maps link", () => {
    const url =
      "https://www.google.com/maps/place/X/@10.7,106.6,17z/data=!3m1!4b1!4m6!3m5!1s0x31752f3a9d8d1bb3:0xd3f1a2b4c5d6e7f8!8m2";
    expect(placeRefFromUrl(url)).toBe("0x31752f3a9d8d1bb3:0xd3f1a2b4c5d6e7f8");
  });
  it("reads a place id", () => {
    expect(
      placeRefFromUrl("https://www.google.com/maps/search/?api=1&query=x&query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4"),
    ).toBe("ChIJN1t_tDeuEmsRUsoyG83frY4");
  });
  it("returns null when the link carries no id (a paid lookup would be needed)", () => {
    expect(placeRefFromUrl("https://www.google.com/maps/place/Foo/@1.2,3.4,15z")).toBeNull();
  });
});

describe("normalizeMapsUrl", () => {
  it("accepts Google hosts only, so redirects are never followed elsewhere", () => {
    expect(normalizeMapsUrl("maps.app.goo.gl/AbC123")).toBe("https://maps.app.goo.gl/AbC123");
    expect(normalizeMapsUrl("https://www.google.com.vn/maps/place/x")).toBe("https://www.google.com.vn/maps/place/x");
    for (const bad of [
      "https://evil.com/maps",
      "https://notgoogle.com.vn/x",
      "https://fakegoogle.com/maps",
      "https://google.com.evil.io/x",
    ]) {
      expect(normalizeMapsUrl(bad)).toBeNull();
    }
  });
});
