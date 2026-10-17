// Content thumbnails: public-address guard, project-site restriction (incl. redirects), og:image and JSON-LD
// parsing, size/redirect limits, and the 7-day cache including misses (failures for a day). No network: DNS and
// fetch are fakes.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { pg } = await vi.hoisted(async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  return { pg: new PGlite() };
});
const toPositional = (sql: string) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};
vi.mock("@/lib/db", () => ({
  db: {
    prepare: (sql: string) => ({
      get: async (...args: unknown[]) => (await pg.query(toPositional(sql), args)).rows[0],
      all: async (...args: unknown[]) => (await pg.query(toPositional(sql), args)).rows,
      run: async (...args: unknown[]) => {
        const r = await pg.query(toPositional(sql), args);
        return { count: r.affectedRows ?? 0, rows: r.rows };
      },
    }),
  },
  tableExists: async () => true,
}));

import { MIGRATIONS } from "@/db/migrations";
import { ERROR_TTL_MS, META_TTL_MS, UnsafeUrl, assertPublicUrl, extractThumbnail, fetchHtml, isPublicAddress, onSite, thumbnails } from "@/lib/pageMeta";

const publicDns = async () => ["93.184.216.34"];
const html = (head: string) => new Response(`<html><head>${head}</head><body>${"x".repeat(100)}</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });

beforeAll(async () => {
  for (const s of MIGRATIONS.find((m) => m.id === "0011_page_meta")!.statements) await pg.exec(s);
});
beforeEach(async () => {
  await pg.exec("DELETE FROM page_meta");
});

describe("guards", () => {
  it("only public unicast addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "192.0.0.8"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111", "172.32.0.1"]) expect(isPublicAddress(ip), ip).toBe(true);
  });

  it("refuses private hosts, odd schemes, ports and credentials", async () => {
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data")).rejects.toBeInstanceOf(UnsafeUrl);
    await expect(assertPublicUrl("https://intranet.wewine.vn/", async () => ["10.0.0.5"])).rejects.toBeInstanceOf(UnsafeUrl);
    await expect(assertPublicUrl("https://mixed.wewine.vn/", async () => ["93.184.216.34", "127.0.0.1"])).rejects.toBeInstanceOf(UnsafeUrl);
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toBeInstanceOf(UnsafeUrl);
    await expect(assertPublicUrl("https://wewine.vn:8443/", publicDns)).rejects.toBeInstanceOf(UnsafeUrl);
    await expect(assertPublicUrl("https://user:pw@wewine.vn/", publicDns)).rejects.toBeInstanceOf(UnsafeUrl);
    await expect(assertPublicUrl("https://wewine.vn/", publicDns)).resolves.toBeInstanceOf(URL);
  });

  it("pages must be on the project's site, also after redirects", async () => {
    expect(onSite("https://www.wewine.vn/a", "https://wewine.vn/")).toBe(true);
    expect(onSite("https://blog.wewine.vn/a", "wewine.vn")).toBe(true);
    expect(onSite("https://wewine.vn.evil.com/a", "wewine.vn")).toBe(false);
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://evil.example/x" } }));
    await expect(fetchHtml("https://wewine.vn/a", "wewine.vn", { resolve: publicDns, fetchImpl: fetchImpl as never })).rejects.toThrow("off the project's site");
    const loop = vi.fn(async () => new Response(null, { status: 301, headers: { location: "https://wewine.vn/again" } }));
    await expect(fetchHtml("https://wewine.vn/a", "wewine.vn", { resolve: publicDns, fetchImpl: loop as never })).rejects.toThrow("Too many redirects");
    expect(loop).toHaveBeenCalledTimes(4);
  });

  it("stops reading at the size limit", async () => {
    const big = new Response(new ReadableStream({ start(c) { for (let i = 0; i < 100; i++) c.enqueue(new TextEncoder().encode("a".repeat(10_000))); c.close(); } }), { headers: { "content-type": "text/html" } });
    const { html: body } = await fetchHtml("https://wewine.vn/a", "wewine.vn", { resolve: publicDns, fetchImpl: (async () => big) as never });
    expect(body.length).toBeLessThanOrEqual(512 * 1024);
  });
});

describe("parsing", () => {
  it("og:image first, relative URLs resolved, then article JSON-LD", () => {
    expect(extractThumbnail(`<meta content="/img/a.jpg?x=1&amp;y=2" property="og:image">`, "https://wewine.vn/blog/p")).toEqual({ image: "https://wewine.vn/img/a.jpg?x=1&y=2", source: "og" });
    const ld = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization"},{"@type":"BlogPosting","image":{"@type":"ImageObject","url":"https://cdn.wewine.vn/b.webp"}}]}</script>`;
    expect(extractThumbnail(ld, "https://wewine.vn/p")).toEqual({ image: "https://cdn.wewine.vn/b.webp", source: "jsonld" });
    expect(extractThumbnail(`<script type="application/ld+json">{bad json</script><meta property="og:image" content="javascript:alert(1)">`, "https://wewine.vn/")).toBeNull();
  });
});

describe("cache", () => {
  it("saves hits and misses for 7 days, failures for a day; refresh refetches; off-site URLs never fetched", async () => {
    const now = Date.parse("2026-10-16T00:00:00Z");
    const fetchImpl = vi.fn(async (url: string) => (url.endsWith("/a") ? html(`<meta property="og:image" content="https://wewine.vn/a.jpg">`) : url.endsWith("/b") ? html("") : new Response("no", { status: 500 })));
    const opts = { resolve: publicDns, fetchImpl: fetchImpl as never };
    const urls = ["https://wewine.vn/a", "https://wewine.vn/b", "https://wewine.vn/c", "https://other.com/x"];
    const first = await thumbnails(urls, "https://wewine.vn/", { ...opts, now });
    expect(first.map((t) => [t.source, t.image])).toEqual([
      ["og", "https://wewine.vn/a.jpg"],
      ["none", null],
      ["error", null],
      ["error", null],
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await thumbnails(urls, "https://wewine.vn/", { ...opts, now: now + ERROR_TTL_MS - 1000 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await thumbnails(urls, "https://wewine.vn/", { ...opts, now: now + ERROR_TTL_MS + 1000 });
    expect(fetchImpl).toHaveBeenCalledTimes(4); // only the failed one again
    await thumbnails(urls, "https://wewine.vn/", { ...opts, now: now + META_TTL_MS + 1000 });
    expect(fetchImpl).toHaveBeenCalledTimes(7);
    await thumbnails(urls.slice(0, 1), "https://wewine.vn/", { ...opts, now: now + META_TTL_MS + 2000, refresh: true });
    expect(fetchImpl).toHaveBeenCalledTimes(8);
  });

  it("a CMS mapping wins when available", async () => {
    const fetchImpl = vi.fn();
    const [t] = await thumbnails(["https://wewine.vn/a"], "wewine.vn", { resolve: publicDns, fetchImpl: fetchImpl as never, cms: async () => "https://cms.wewine.vn/a.jpg" });
    expect(t).toMatchObject({ source: "cms", image: "https://cms.wewine.vn/a.jpg" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
