import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isDenied, viewer } from "@/lib/access";
import { identitiesOf } from "@/lib/auth/identities";
import { isDocsAdmin } from "@/lib/docs/store";

/** The signed-in person's own profile: name, job title (profile information, not a role), logins and Asana user. */
export async function GET() {
  const user = await viewer();
  if (isDenied(user)) return user;
  const identities = await identitiesOf(user.id);
  return NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    picture: user.picture,
    jobTitle: user.job_title,
    signedInAs: user.identity_email,
    identities: identities.map((i) => ({ id: i.id, email: i.email, hostedDomain: i.hostedDomain, createdAt: i.createdAt, lastLoginAt: i.lastLoginAt, current: i.id === user.identity_id })),
    asana: user.asana_user_gid ? { gid: user.asana_user_gid, name: user.asana_user_name } : null,
    docsPublisher: await isDocsAdmin(user),
  });
}

/** Edits the person's own name and job title (nobody can edit another person's profile). */
export async function PUT(req: NextRequest) {
  const user = await viewer();
  if (isDenied(user)) return user;
  const body = (await req.json().catch(() => ({}))) as { name?: unknown; jobTitle?: unknown };
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : undefined;
  const jobTitle = typeof body.jobTitle === "string" ? body.jobTitle.trim().slice(0, 120) : undefined;
  await db
    .prepare("UPDATE users SET name = COALESCE(?, name), job_title = CASE WHEN ? THEN ? ELSE job_title END, updated_at = ? WHERE id = ?")
    .run(name || null, jobTitle !== undefined, jobTitle || null, Date.now(), user.id);
  return NextResponse.json({ ok: true });
}
