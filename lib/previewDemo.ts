// Synthetic demo projects for Preview and local development.
//
// The Preview database starts empty, and the fixture account seeded by
// scripts/seed-preview.mts can't sign in. This lets an approved user who has
// signed in add a few invented projects to *their own* account, so the
// dashboards have something to show. Demo projects are ordinary rows owned by
// that user: nobody else sees them, and no real project is touched.
//
// Demo websites use the reserved .example top-level domain (RFC 2606), which
// no real site can use; the v2 dashboards treat such projects as demo data.
import { db } from "@/lib/db";
import { deploymentOf, type Deployment } from "@/lib/environment";

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
 * Adds any missing demo projects to this user's account (matched by name, so
 * running it twice creates nothing new). Returns the names that were created.
 */
export async function createDemoProjects(userId: number, now = Date.now()): Promise<string[]> {
  const created: string[] = [];
  for (const p of DEMO_PROJECTS) {
    const exists = await db.prepare("SELECT id FROM projects WHERE user_id = ? AND name = ?").get(userId, p.name);
    if (exists) continue;
    await db
      .prepare(
        `INSERT INTO projects (user_id, name, website_url, favicon_url, created_at, updated_at)
         VALUES (?, ?, ?, '', ?, ?)`,
      )
      .run(userId, p.name, p.websiteUrl, now, now);
    created.push(p.name);
  }
  return created;
}
