import { describe, expect, it } from "vitest";
import { csvCell } from "@/app/components/csv";

describe("csvCell", () => {
  it("neutralises cells a spreadsheet would run as a formula", () => {
    for (const lead of ["=", "+", "-", "@", "\t", "\r"]) {
      expect(csvCell(`${lead}HYPERLINK("http://x")`).replace(/^"/, "")).toMatch(/^'/);
    }
    expect(csvCell("-site:example.com hotel")).toBe("'-site:example.com hotel");
  });

  it("keeps numbers and number-only text numeric", () => {
    expect(csvCell(-12.5)).toBe("-12.5");
    expect(csvCell("-12.5")).toBe("-12.5");
    expect(csvCell("-3%")).toBe("-3%");
    expect(csvCell(0)).toBe("0");
  });

  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("writes missing values as empty cells, not 'null'", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("leaves ordinary text and URLs alone", () => {
    expect(csvCell("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(csvCell("giá phòng")).toBe("giá phòng");
  });
});
