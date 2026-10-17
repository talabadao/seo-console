// Competitors coverage: the top 10 is read for the highest-search-volume keywords in resumable batches. Each keyword
// is read once per check date, a failed keyword isn't retried forever, coverage is reported honestly, and a new check
// date starts over. seGet is a fake that counts calls; nothing touches the network or the database.
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: Array<{ path: string; params: Record<string, unknown> }> = [];
let failKeyword: string | null = null;

vi.mock("@/lib/seranking/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/seranking/client")>("@/lib/seranking/client");
  return {
    ...actual,
    seGet: async (path: string, params: Record<string, unknown> = {}) => {
      calls.push({ path, params });
      if (path.endsWith("competitors/metrics")) return [{ domain: "wewine.vn", visibility: 12.5, backlinks: 10, domains: 4 }, { domain: "rival.example", visibility: 20, backlinks: 5, domains: 2 }];
      if (path.endsWith("competitors/serp10")) {
        if (String(params.keyword_id) === failKeyword) throw new actual.SeRankingError(500, "boom");
        return [{ position: 1, url: "https://rival.example/a" }, { position: 4, url: "https://wewine.vn/b" }];
      }
      return [];
    },
  };
});

import { fetchCompetition } from "@/lib/seranking/donor/fetch";
import type { SeEngine, SeKeyword } from "@/lib/seranking/donor/types";

const engine: SeEngine = { id: 1, searchEngineId: 1, name: "Google VN", region: null, lang: "vi", keywordCount: 87 };
const kw = (i: number): SeKeyword => ({ id: `k${i}`, engineId: 1, name: `keyword ${i}`, groupId: null, volume: 1000 - i, cpc: null, competition: null, landing: null, features: [], ownFeatures: [], positions: [{ date: "2026-10-16", pos: 3 }], current: 3, change1: null, change7: null, change30: null, best: 3 });
const keywords = Array.from({ length: 87 }, (_, i) => kw(i));
const serpCalls = () => calls.filter((c) => c.path.endsWith("serp10")).map((c) => String(c.params.keyword_id));

beforeEach(() => {
  calls.length = 0;
  failKeyword = null;
});

describe("competition batches", () => {
  it("reads highest volume first in batches, never re-reads, and reports coverage until complete", async () => {
    const opts = { limit: 100, batch: 40 };
    const a = await fetchCompetition(1, engine, "2026-10-16", keywords, "wewine.vn", [], opts);
    expect(serpCalls()).toEqual(keywords.slice(0, 40).map((k) => k.id));
    expect(a.coverage).toMatchObject({ read: 40, attempted: 40, target: 87, total: 87, complete: false });
    expect(a.keywordCount).toBe(40);

    calls.length = 0;
    const b = await fetchCompetition(1, engine, "2026-10-16", keywords, "wewine.vn", [], { ...opts, previous: a });
    expect(serpCalls()).toEqual(keywords.slice(40, 80).map((k) => k.id));
    expect(b.coverage).toMatchObject({ read: 80, complete: false });

    calls.length = 0;
    const c = await fetchCompetition(1, engine, "2026-10-16", keywords, "wewine.vn", [], { ...opts, previous: b });
    expect(serpCalls()).toEqual(keywords.slice(80).map((k) => k.id));
    expect(c.coverage).toMatchObject({ read: 87, attempted: 87, total: 87, complete: true });
    // The own domain's keyword count covers everything read across the batches.
    expect(c.domains.find((d) => d.isOwn)).toMatchObject({ top10: 87 });
  });

  it("the limit caps coverage and says so; keywords beyond it are never read", async () => {
    let r = await fetchCompetition(1, engine, "2026-10-16", keywords, "wewine.vn", [], { limit: 50, batch: 40 });
    r = await fetchCompetition(1, engine, "2026-10-16", keywords, "wewine.vn", [], { limit: 50, batch: 40, previous: r });
    expect(r.coverage).toMatchObject({ read: 50, target: 50, total: 87, limit: 50, complete: true });
    expect(new Set(serpCalls()).size).toBe(50);
  });

  it("a failed keyword is attempted once and doesn't keep the dataset open", async () => {
    failKeyword = "k3";
    const r = await fetchCompetition(1, engine, "2026-10-16", keywords.slice(0, 10), "wewine.vn", [], { limit: 100, batch: 40 });
    expect(r.coverage).toMatchObject({ read: 9, attempted: 10, complete: true });
    calls.length = 0;
    await fetchCompetition(1, engine, "2026-10-16", keywords.slice(0, 10), "wewine.vn", [], { limit: 100, batch: 40, previous: r });
    expect(serpCalls()).toEqual([]);
  });

  it("a new check date starts over", async () => {
    const a = await fetchCompetition(1, engine, "2026-10-16", keywords, "wewine.vn", [], { limit: 100, batch: 40 });
    calls.length = 0;
    const b = await fetchCompetition(1, engine, "2026-10-17", keywords, "wewine.vn", [], { limit: 100, batch: 40, previous: a });
    expect(serpCalls()).toEqual(keywords.slice(0, 40).map((k) => k.id));
    expect(b.coverage?.read).toBe(40);
  });
});
