// Monthly work summary from a project's Asana tasks. Pure, so the counting
// rules are testable without Asana:
//   completed this month  completion date (completed_at) in the month, whatever the due date
//   due this month        due date in the month, done or not
//   overdue               not completed and due before today
// Asana's task list is fetched with completed_since = start of the month, so
// it holds every open task plus everything completed this month.

import type { TaskData, TaskRef } from "./types";

export interface RawTask {
  gid: string;
  name: string;
  completed: boolean;
  completed_at: string | null;
  due_on: string | null;
  assignee: { gid?: string; name: string } | null;
  permalink_url: string | null;
}

const LIST = 8;

export function summarizeTasks(
  tasks: RawTask[],
  month: { yearMonth: string; monthStart: string; monthEnd: string; today: string },
  projectUrl: string | null,
  upcomingDays = 14,
): TaskData {
  const inMonth = (d: string | null) => d != null && d >= month.monthStart && d <= month.monthEnd;
  const horizon = new Date(`${month.today}T00:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + upcomingDays);
  const horizonYmd = horizon.toISOString().slice(0, 10);

  const ref = (t: RawTask): TaskRef => ({
    gid: t.gid,
    name: t.name,
    assignee: t.assignee?.name ?? null,
    assigneeGid: t.assignee?.gid ?? null,
    dueOn: t.due_on,
    completedAt: t.completed_at,
    status: t.completed ? "completed" : t.due_on != null && t.due_on < month.today ? "overdue" : "open",
    url: t.permalink_url,
  });

  const completedInMonth = tasks.filter((t) => t.completed && inMonth(t.completed_at ? t.completed_at.slice(0, 10) : null));
  const overdue = tasks.filter((t) => !t.completed && t.due_on != null && t.due_on < month.today);
  const upcoming = tasks.filter((t) => !t.completed && t.due_on != null && t.due_on >= month.today && t.due_on <= horizonYmd);

  return {
    yearMonth: month.yearMonth,
    monthStart: month.monthStart,
    monthEnd: month.monthEnd,
    today: month.today,
    dueThisMonth: tasks.filter((t) => inMonth(t.due_on)).length,
    completedThisMonth: completedInMonth.length,
    overdue: overdue.length,
    overdueTasks: overdue.sort((a, b) => (a.due_on! < b.due_on! ? -1 : 1)).slice(0, LIST).map(ref),
    upcoming: upcoming.sort((a, b) => (a.due_on! < b.due_on! ? -1 : 1)).slice(0, LIST).map(ref),
    recentlyCompleted: completedInMonth
      .sort((a, b) => (a.completed_at! > b.completed_at! ? -1 : 1))
      .slice(0, LIST)
      .map(ref),
    projectUrl,
  };
}
