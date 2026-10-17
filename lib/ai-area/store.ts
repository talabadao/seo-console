// AI Area documents in Postgres (table ai_documents, migration 0003), keyed by SEO Console project.
// Replaces the donor app's Vercel Blob JSON files. Callers check project ownership first (API routes).

import { db, tableExists } from "@/lib/db";

export class AiAreaUnavailable extends Error {
  constructor() {
    super("This database hasn't run migration 0003 (AI Area) yet.");
    this.name = "AiAreaUnavailable";
  }
}

export async function aiAreaReady(): Promise<boolean> {
  return tableExists("ai_documents");
}

async function ensure() {
  if (!(await aiAreaReady())) throw new AiAreaUnavailable();
}

export async function readDoc<T>(projectId: number, kind: string, key: string): Promise<T | null> {
  await ensure();
  const row = (await db.prepare("SELECT data FROM ai_documents WHERE project_id = ? AND kind = ? AND doc_key = ?").get(projectId, kind, key)) as
    | { data: unknown }
    | undefined;
  if (!row) return null;
  return (typeof row.data === "string" ? JSON.parse(row.data) : row.data) as T;
}

export async function writeDoc(projectId: number, kind: string, key: string, data: unknown): Promise<void> {
  await ensure();
  await db
    .prepare(
      `INSERT INTO ai_documents (project_id, kind, doc_key, data, updated_at) VALUES (?, ?, ?, ?::jsonb, ?)
       ON CONFLICT (project_id, kind, doc_key) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
    )
    .run(projectId, kind, key, JSON.stringify(data), Date.now());
}

export async function listDocs<T>(projectId: number, kind: string): Promise<{ key: string; data: T; updatedAt: number }[]> {
  await ensure();
  const rows = (await db.prepare("SELECT doc_key, data, updated_at FROM ai_documents WHERE project_id = ? AND kind = ? ORDER BY doc_key").all(projectId, kind)) as {
    doc_key: string;
    data: unknown;
    updated_at: number;
  }[];
  return rows.map((r) => ({ key: r.doc_key, data: (typeof r.data === "string" ? JSON.parse(r.data) : r.data) as T, updatedAt: Number(r.updated_at) }));
}

export async function deleteDoc(projectId: number, kind: string, key: string): Promise<void> {
  await ensure();
  await db.prepare("DELETE FROM ai_documents WHERE project_id = ? AND kind = ? AND doc_key = ?").run(projectId, kind, key);
}
