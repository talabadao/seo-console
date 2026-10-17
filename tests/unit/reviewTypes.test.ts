import { describe, expect, it } from "vitest";
import { starSentiment } from "@/lib/reviewTypes";

describe("starSentiment", () => {
  it("maps star ratings to the fallback sentiment used before text analysis", () => {
    expect([5, 4, 3, 2, 1].map(starSentiment)).toEqual(["positive", "positive", "neutral", "negative", "negative"]);
  });
});
