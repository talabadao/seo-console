import { addDays, endOfWeek, startOfWeek, subDays } from "date-fns";

const API = "https://app.asana.com/api/1.0";

async function afetch<T = unknown>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const body = await res.text();
  if (!res.ok) {
    let message = body.slice(0, 500);
    try {
      const j = JSON.parse(body);
      message = (j.errors ?? []).map((e: { message?: string }) => e.message).join("; ") || message;
    } catch {
      // keep raw body
    }
    throw new Error(`Asana API ${res.status}: ${message}`);
  }
  return body ? JSON.parse(body) : (undefined as T);
}

/** Verifies a token works and returns the token owner's name, for the Settings "connected" check. */
export async function verifyAsanaToken(token: string): Promise<{ name: string }> {
  const j = await afetch<{ data: { name: string } }>(token, "/users/me?opt_fields=name");
  return { name: j.data.name };
}

export interface AsanaProject {
  gid: string;
  name: string;
  permalink_url: string;
}

export async function getProject(token: string, projectGid: string): Promise<AsanaProject> {
  const j = await afetch<{ data: AsanaProject }>(
    token,
    `/projects/${encodeURIComponent(projectGid)}?opt_fields=name,permalink_url`,
  );
  return j.data;
}

export interface AsanaTask {
  gid: string;
  name: string;
  completed: boolean;
  completed_at: string | null;
  due_on: string | null;
  assignee: { name: string } | null;
  permalink_url: string;
}

/** Every incomplete task, plus every task completed since `sinceISO` — paginated. */
async function fetchProjectTasks(token: string, projectGid: string, sinceISO: string): Promise<AsanaTask[]> {
  const out: AsanaTask[] = [];
  let offset: string | null = null;
  const optFields = "name,completed,completed_at,due_on,assignee.name,permalink_url";
  do {
    const params = new URLSearchParams({
      completed_since: sinceISO,
      opt_fields: optFields,
      limit: "100",
    });
    if (offset) params.set("offset", offset);
    const j: { data: AsanaTask[]; next_page: { offset: string } | null } = await afetch(
      token,
      `/projects/${encodeURIComponent(projectGid)}/tasks?${params}`,
    );
    out.push(...j.data);
    offset = j.next_page?.offset ?? null;
  } while (offset);
  return out;
}

export interface TaskBuckets {
  completedRecently: AsanaTask[];
  dueThisWeek: AsanaTask[];
  dueNextWeek: AsanaTask[];
}

/**
 * Buckets a project's tasks into "completed in the last 14 days", "due this
 * (Mon-Sun) week", and "due next week" — everything the Weekly Report's task
 * export needs from one paginated fetch (Asana's project-tasks endpoint only
 * filters by completion, not a due-date range, so the week buckets are
 * computed client-side here).
 */
export async function projectTaskBuckets(
  token: string,
  projectGid: string,
  anchor: Date = new Date(),
): Promise<TaskBuckets> {
  const since = subDays(anchor, 14);
  const tasks = await fetchProjectTasks(token, projectGid, since.toISOString());

  const thisWeekStart = startOfWeek(anchor, { weekStartsOn: 1 });
  const thisWeekEnd = endOfWeek(anchor, { weekStartsOn: 1 });
  const nextWeekStart = addDays(thisWeekStart, 7);
  const nextWeekEnd = addDays(thisWeekEnd, 7);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);

  const completedRecently = tasks
    .filter((t) => t.completed && t.completed_at && new Date(t.completed_at) >= since)
    .sort((a, b) => (b.completed_at! < a.completed_at! ? -1 : 1));

  const inRange = (dueOn: string | null, start: string, end: string) =>
    dueOn != null && dueOn >= start && dueOn <= end;

  const dueThisWeek = tasks
    .filter((t) => !t.completed && inRange(t.due_on, ymd(thisWeekStart), ymd(thisWeekEnd)))
    .sort((a, b) => (a.due_on! < b.due_on! ? -1 : 1));

  const dueNextWeek = tasks
    .filter((t) => !t.completed && inRange(t.due_on, ymd(nextWeekStart), ymd(nextWeekEnd)))
    .sort((a, b) => (a.due_on! < b.due_on! ? -1 : 1));

  return { completedRecently, dueThisWeek, dueNextWeek };
}

export type AsanaStatusType =
  | "on_track"
  | "at_risk"
  | "off_track"
  | "on_hold"
  | "complete"
  | "achieved";

export async function createStatusUpdate(
  token: string,
  opts: { parent: string; title: string; text: string; statusType: AsanaStatusType },
): Promise<{ gid: string; permalinkUrl: string | null }> {
  // Asana rejects the request if both `text` and `html_text` are present
  // ("Must supply only one of text or html_text"). Sending html_text alone
  // is well-formed per their docs but Asana has a long-standing, staff-
  // acknowledged bug where it's stored without being rendered — the status
  // update shows the literal "<body><p><strong>..." markup instead of
  // formatted text (https://forum.asana.com/t/rich-text-does-not-work-for-status-updates/31311).
  // Until Asana fixes that, send plain `text` so the content is at least
  // readable, even without bold/bullets.
  const j = await afetch<{ data: { gid: string; permalink_url?: string } }>(
    token,
    "/status_updates?opt_fields=permalink_url",
    {
      method: "POST",
      body: JSON.stringify({
        data: {
          parent: opts.parent,
          title: opts.title,
          text: opts.text,
          status_type: opts.statusType,
        },
      }),
    },
  );
  return { gid: j.data.gid, permalinkUrl: j.data.permalink_url ?? null };
}
