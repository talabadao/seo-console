import type { Migration } from "../../lib/migrations";

/**
 * Page thumbnails for Search Console's "Your content" (lib/pageMeta.ts): the image found on a public page
 * (og:image or article JSON-LD), or that there was none, saved for 7 days (failed fetches for 1 day) and shared by
 * every server instance. Keyed by a hash of the page URL; public page data only, no credentials. Pages are only
 * read for URLs on the requesting project's own site.
 */
export const migration: Migration = {
  id: "0011_page_meta",
  description: "Saved page thumbnails (og:image / JSON-LD) for the content list",
  statements: [
    `CREATE TABLE IF NOT EXISTS page_meta (
       url_hash    TEXT PRIMARY KEY,
       url         TEXT NOT NULL,
       image       TEXT,
       source      TEXT NOT NULL CHECK (source IN ('cms', 'og', 'jsonld', 'none', 'error')),
       fetched_at  BIGINT NOT NULL
     )`,
  ],
};
