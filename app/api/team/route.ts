import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isDenied, viewer } from "@/lib/access";

/**
 * The team directory: every active person in the workspace with name, avatar, company login addresses, job title,
 * the projects they manage and their confirmed Asana user, plus the workspace's brand labels. Never logins' secrets,
 * budgets, usage or inboxes.
 */
export async function GET() {
  const user = await viewer();
  if (isDenied(user)) return user;
  const people = (await db
    .prepare(
      `SELECT u.id, u.name, u.picture, u.job_title, u.asana_user_name, (u.asana_user_gid IS NOT NULL) AS asana_confirmed,
              COALESCE((SELECT array_agg(i.email ORDER BY i.email) FROM user_identities i WHERE i.user_id = u.id), '{}') AS emails,
              COALESCE((SELECT json_agg(json_build_object('id', p.id, 'name', p.name, 'primary', p.primary_manager_id = u.id) ORDER BY lower(p.name))
                          FROM project_members m JOIN projects p ON p.id = m.project_id AND p.deleted_at IS NULL WHERE m.user_id = u.id), '[]') AS projects
         FROM users u
        WHERE u.workspace_id = ? AND u.kind = 'person' AND u.status = 'active'
          AND EXISTS (SELECT 1 FROM user_identities i WHERE i.user_id = u.id)
        ORDER BY lower(COALESCE(u.name, u.email))`,
    )
    .all(user.workspace_id)) as Array<Record<string, unknown>>;
  const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
  const brands = (await db.prepare("SELECT id, name, email_domain FROM brands WHERE workspace_id = ? ORDER BY name").all(user.workspace_id)) as Array<Record<string, unknown>>;
  return NextResponse.json({
    me: user.id,
    brands: brands.map((b) => ({ id: Number(b.id), name: String(b.name), domain: String(b.email_domain) })),
    people: people.map((p) => ({
      id: Number(p.id),
      name: (p.name as string | null) ?? null,
      picture: (p.picture as string | null) ?? null,
      jobTitle: (p.job_title as string | null) ?? null,
      emails: (p.emails as string[]) ?? [],
      asana: p.asana_confirmed ? (p.asana_user_name as string | null) : null,
      projects: (parse(p.projects) as Array<{ id: number; name: string; primary: boolean }>) ?? [],
    })),
  });
}
