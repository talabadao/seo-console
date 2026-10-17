// Server-side authorization for the team workspace (docs/seo-console-v2/WORKSPACE-MEMBERS.md, permission matrix).
// Routes use these helpers instead of filtering by a personal user_id:
// - viewer(): the signed-in, active person (401 otherwise);
// - viewProject(): any live project in the viewer's workspace (404 otherwise — never another workspace's);
// - manageProject(): a project the viewer manages (403 with who can grant access, for viewers);
// - projectGoogle()/gscForProperty()/gaForProperty(): Google data through the project's mapped shared connection.
// Personal data (credentials, budgets, usage, inbox, private reports) stays keyed by the viewer's own User id.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentUser, type UserRow } from "@/lib/session";
import { getProject, listManagers, projectForGa, projectForGsc, type Project } from "@/lib/projects";
import { ConnectionUnavailableError, connectionAccessToken } from "@/lib/google/connections";

export type Denied = NextResponse;

export async function viewer(): Promise<UserRow | Denied> {
  const user = await currentUser();
  return user ?? NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export const isDenied = (v: unknown): v is NextResponse => v instanceof NextResponse;

/** The explanation shown to a viewer who tries to change something. */
export async function managementRequired(project: Project): Promise<NextResponse> {
  const managers = await listManagers(project.id);
  return NextResponse.json(
    {
      error: "management-required",
      message: managers.length
        ? `Viewing is open to the whole team; changing or running things in ${project.name} needs management access. Ask one of its managers to share it with you: ${managers.map((m) => m.name ?? m.email).join(", ")}.`
        : `${project.name} has no manager yet. Ask the operator to assign one.`,
      managers: managers.map((m) => ({ userId: m.userId, name: m.name, email: m.email, isPrimary: m.isPrimary })),
    },
    { status: 403 },
  );
}

export async function viewProject(user: UserRow, projectId: unknown): Promise<Project | Denied> {
  const id = Number(projectId);
  const project = Number.isSafeInteger(id) && id > 0 ? await getProject(user.id, id) : null;
  return project ?? NextResponse.json({ error: "unknown project" }, { status: 404 });
}

export async function manageProject(user: UserRow, projectId: unknown): Promise<Project | Denied> {
  const p = await viewProject(user, projectId);
  if (isDenied(p)) return p;
  return p.canManage ? p : managementRequired(p);
}

// --- Google data through shared connections -------------------------------------------------------------------

export interface GoogleAccess {
  connectionId: number;
  token: () => Promise<string>;
}

export interface GscAccess extends GoogleAccess {
  project: Project;
  property: string;
  /** The discovered site row of this connection and property (incremental data, site settings), or null. */
  siteId: number | null;
}

export interface GaAccess extends GoogleAccess {
  project: Project;
  propertyId: string;
}

const tokenFor = (connectionId: number) => () => connectionAccessToken(connectionId);

/** The project's Search Console access, or why there is none. */
export async function projectGsc(project: Project): Promise<GscAccess | ConnectionUnavailableError> {
  if (!project.gscProperty || project.gscConnectionId == null) return new ConnectionUnavailableError(null, "not-mapped");
  const site = (await db
    .prepare("SELECT id FROM sites WHERE connection_id = ? AND source = 'google' AND property = ?")
    .get(project.gscConnectionId, project.gscProperty)) as { id: number } | undefined;
  return { project, property: project.gscProperty, connectionId: project.gscConnectionId, siteId: site ? Number(site.id) : null, token: tokenFor(project.gscConnectionId) };
}

export async function projectGa(project: Project): Promise<GaAccess | ConnectionUnavailableError> {
  if (!project.gaPropertyId || project.gaConnectionId == null) return new ConnectionUnavailableError(null, "not-mapped");
  return { project, propertyId: project.gaPropertyId, connectionId: project.gaConnectionId, token: tokenFor(project.gaConnectionId) };
}

/**
 * Search Console access for a property-based route: the property must be mapped by a live project the viewer can see
 * (preferring ?projectId when given); the data is read through that project's connection.
 */
export async function gscForProperty(user: UserRow, property: string | null | undefined, preferProjectId?: unknown): Promise<GscAccess | null> {
  if (!property) return null;
  const project = await projectForGsc(user.id, property, Number(preferProjectId) || null);
  if (!project) return null;
  const a = await projectGsc(project);
  return a instanceof ConnectionUnavailableError ? null : a;
}

export async function gaForProperty(user: UserRow, propertyId: string | null | undefined): Promise<GaAccess | null> {
  if (!propertyId) return null;
  const project = await projectForGa(user.id, propertyId);
  if (!project) return null;
  const a = await projectGa(project);
  return a instanceof ConnectionUnavailableError ? null : a;
}

/** The GA4 property's time zone and currency as discovered by its connection (null when not known yet). */
export async function gaPropertyMeta(connectionId: number, propertyId: string): Promise<{ timeZone: string | null; currency: string | null }> {
  const r = (await db.prepare("SELECT time_zone, currency_code FROM ga_properties WHERE connection_id = ? AND property_id = ?").get(connectionId, propertyId)) as
    | { time_zone: string | null; currency_code: string | null }
    | undefined;
  return { timeZone: r?.time_zone ?? null, currency: r?.currency_code ?? null };
}

/**
 * Health of a mapped connection, so a revoked or disconnected grant shows a reconnect state instead of its cached
 * results. null when nothing is mapped (the section reports "not connected" itself).
 */
export async function connectionState(connectionId: number | null): Promise<{ status: "ok" | "needs-reconnect" | "disconnected" | "missing"; message: string } | null> {
  if (connectionId == null) return null;
  const r = (await db.prepare("SELECT email, status FROM google_connections WHERE id = ?").get(connectionId)) as { email: string; status: string } | undefined;
  if (!r) return { status: "missing", message: "The mapped Google connection no longer exists. Choose another in Project settings → Integrations." };
  if (r.status === "ok") return { status: "ok", message: "" };
  return r.status === "disconnected"
    ? { status: "disconnected", message: `The Google connection ${r.email} was disconnected. Reconnect it in Account → Data connections.` }
    : { status: "needs-reconnect", message: `The Google connection ${r.email} needs to be reconnected (Account → Data connections).` };
}

/** Whether a connection's granted scopes include one (null scopes: unknown, treated as granted until a call fails). */
export async function connectionHasScope(connectionId: number, scope: string): Promise<boolean> {
  const r = (await db.prepare("SELECT scopes FROM google_connections WHERE id = ?").get(connectionId)) as { scopes: string | null } | undefined;
  return !r?.scopes || r.scopes.split(/\s+/).includes(scope);
}
