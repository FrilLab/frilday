import { buildWeekDates, dayOfWeek, toYmd } from '../../shared/utils/date';
import { isScheduledOn } from './schedule';
import type { Completion, Task } from '../../shared/types';

// (role: resolve backlog limit, type: (Task)=>number|null)
function toBacklogLimit(task: Task): number | null {
  // repeatCount is primary schedule backlog limit.
  // Keep temporary autoArchiveAfter fallback only for legacy data that used it as the only limit.
  const raw = task.repeatCount ?? task.autoArchiveAfter ?? null;
  if (raw == null) return null;

  const parsed = Math.floor(Number(raw));
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return parsed;
}

// (role: derive effective schedule start ymd, type: (Task)=>string)
function effectiveStartYmd(task: Task): string {
  const createdAtYmd = toYmd(new Date(task.createdAt));
  const userStartYmd = (task.startYmd ?? '').trim();

  if (!userStartYmd) return createdAtYmd;
  return userStartYmd < createdAtYmd ? createdAtYmd : userStartYmd;
}

// (role: unique done dates for a task, type: (Completion[], string)=>Set<string>)
function doneDateSetAll(
  completions: Completion[],
  taskId: string,
): Set<string> {
  return new Set(
    (completions ?? []).filter((c) => c.taskId === taskId).map((c) => c.date),
  );
}

// (role: done dates within a week, type: (Completion[], string, string, string)=>Set<string>)
function doneDateSetInWeek(
  completions: Completion[],
  taskId: string,
  weekStartYmd: string,
  weekEndYmd: string,
): Set<string> {
  return new Set(
    (completions ?? [])
      .filter(
        (c) =>
          c.taskId === taskId && c.date >= weekStartYmd && c.date <= weekEndYmd,
      )
      .map((c) => c.date),
  );
}

// (role: pick visible weekly slots for a task, type: (Task, string, Completion[])=>string[])
export function pickWeeklySlots(
  task: Task,
  weekStartYmd: string,
  completions: Completion[],
): string[] {
  const weekDates = buildWeekDates(weekStartYmd);
  const weekEndYmd = weekDates[weekDates.length - 1];

  const cutoffYmd = effectiveStartYmd(task);

  // (role: scheduled dates within the week, type: string[])
  const scheduledDates = weekDates.filter((ymd) => {
    if (ymd < cutoffYmd) return false;
    const date = new Date(`${ymd}T00:00:00`);
    return isScheduledOn(task, dayOfWeek(date));
  });
  const doneThisWeek = doneDateSetInWeek(
    completions,
    task.id,
    weekStartYmd,
    weekEndYmd,
  );
  // Done slots are based on weekDates (not scheduledDates), so completed history never disappears.
  const doneDatesThisWeek = weekDates.filter(
    (d) => d >= cutoffYmd && doneThisWeek.has(d),
  );

  const backlogLimit = toBacklogLimit(task);

  // Unlimited schedule: show scheduled slots + any done slots in this week.
  if (backlogLimit == null) {
    const visible = new Set([...doneDatesThisWeek, ...scheduledDates]);
    return weekDates.filter((d) => d >= cutoffYmd && visible.has(d));
  }

  // Backlog model: repeatCount is lifetime total target.
  const doneAll = doneDateSetAll(completions, task.id);
  const doneTotal = doneAll.size;
  const remainingTotal = Math.max(0, backlogLimit - doneTotal);

  // Backlog exhausted: keep only done slots in displayed week; no planned slots.
  if (remainingTotal === 0) {
    return doneDatesThisWeek;
  }

  // Planned slots this week are capped by remaining lifetime backlog.
  const remainingToShowThisWeek = remainingTotal;
  const queuedDates = scheduledDates
    .filter((d) => !doneThisWeek.has(d))
    .slice(0, remainingToShowThisWeek);

  const visible = new Set([...doneDatesThisWeek, ...queuedDates]);
  // Preserve week order and effective start cutoff.
  return weekDates.filter((d) => d >= cutoffYmd && visible.has(d));
}

// (role: check if task is visible in week on date, type: (Task, string, string, Completion[])=>boolean)
export function isVisibleInWeek(
  task: Task,
  dateYmd: string,
  weekStartYmd: string,
  completions: Completion[],
): boolean {
  return pickWeeklySlots(task, weekStartYmd, completions).includes(dateYmd);
}
