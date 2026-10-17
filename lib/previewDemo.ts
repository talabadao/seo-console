// Synthetic demo projects for Preview and local development.
//
// The Preview database starts empty, and the fixture account seeded by
// scripts/seed-preview.mts can't sign in. This lets an approved user who has
// signed in add a few invented projects to the team workspace, so the
// dashboards have something to show. Demo projects are ordinary projects
// managed by the person who added them; no real project is touched.
//
// Demo websites use the reserved .example top-level domain (RFC 2606), which
// no real site can use; the v2 dashboards treat such projects as demo data.
import { db } from "@/lib/db";
import { deploymentOf, type Deployment } from "@/lib/environment";
import { createProject } from "@/lib/projects";

export const DEMO_PROJECTS: readonly { name: string; websiteUrl: string }[] = [
  { name: "Lumen Coast Resort (demo)", websiteUrl: "https://lumencoast.example/" },
  { name: "Harbor Street Café (demo)", websiteUrl: "https://harborstreet.example/" },
  { name: "Northfield Dental (demo)", websiteUrl: "https://northfielddental.example/" },
];


/** Demo projects can be created only on Preview deployments and in local development. */
export function demoProjectsAllowed(deployment: Deployment = deploymentOf()): boolean {
  return deployment === "preview" || deployment === "development";
}

/**
 * Adds any missing demo projects to the workspace, created by this User (who becomes their manager, like any
 * project they create). Matched by name, so running it twice creates nothing new. Returns the names created.
 */
export async function createDemoProjects(userId: number): Promise<string[]> {
  const created: string[] = [];
  const ws = (await db.prepare("SELECT workspace_id FROM users WHERE id = ?").get(userId)) as { workspace_id: number | null } | undefined;
  if (!ws?.workspace_id) return created;
  for (const p of DEMO_PROJECTS) {
    const exists = await db.prepare("SELECT id FROM projects WHERE workspace_id = ? AND name = ? AND deleted_at IS NULL").get(ws.workspace_id, p.name);
    if (exists) continue;
    await createProject(userId, { name: p.name, websiteUrl: p.websiteUrl });
    created.push(p.name);
  }
  return created;
}
