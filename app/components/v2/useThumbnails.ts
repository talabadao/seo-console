"use client";

// Page thumbnails for the "Your content" list: asked for only once the list scrolls into view, in one request
// for the visible rows; images are lazy-loaded by the browser. A neutral icon shows when there's no image, the
// image fails to load, or the project has no thumbnails (demo, no website). See lib/pageMeta.ts.

import { useEffect, useState } from "react";

type Items = Record<string, string | null>;

function request(projectId: number, urls: string[], refresh: boolean): Promise<Items> {
  const q = new URLSearchParams();
  for (const u of urls) if (/^https?:\/\//i.test(u)) q.append("url", u);
  if (!q.has("url")) return Promise.resolve({});
  if (refresh) q.set("refresh", "1");
  return fetch(`/api/v2/thumbnails/${projectId}?${q}`, refresh ? { cache: "no-store" } : undefined)
    .then((r) => (r.ok ? r.json() : { items: [] }))
    .then((b: { items?: Array<{ url: string; image: string | null }> }) => Object.fromEntries((b.items ?? []).map((i) => [i.url, i.image])))
    .catch(() => ({}));
}

export function useThumbnails(projectId: number | undefined, urls: string[]) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [images, setImages] = useState<Items>({});
  const [busy, setBusy] = useState(false);
  const key = urls.join("\n");

  useEffect(() => {
    if (!projectId || visible || !node) return;
    if (typeof IntersectionObserver === "undefined") {
      const t = setTimeout(() => setVisible(true), 0);
      return () => clearTimeout(t);
    }
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: "200px" });
    io.observe(node);
    return () => io.disconnect();
  }, [projectId, visible, node]);

  useEffect(() => {
    if (!visible || !projectId || !key) return;
    let live = true;
    request(projectId, key.split("\n"), false).then((items) => live && setImages((prev) => ({ ...prev, ...items })));
    return () => {
      live = false;
    };
  }, [visible, projectId, key]);

  return {
    setNode,
    images,
    busy,
    broken: (url: string) => setImages((prev) => ({ ...prev, [url]: null })),
    refresh: async () => {
      if (!projectId || !key) return;
      setBusy(true);
      const items = await request(projectId, key.split("\n"), true);
      setImages((prev) => ({ ...prev, ...items }));
      setBusy(false);
    },
  };
}
