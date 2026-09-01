import type { TimeEntry } from '../../shared/types';
import { diffMinutes } from '../../shared/utils/date';

function normalizedStoredMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return 0;
  return Math.max(0, Math.floor(minutes));
}

// (role: calculate one entry's current or persisted duration, type: (TimeEntry, string)=>number)
export function getTrackedMinutes(entry: TimeEntry, nowIso: string): number {
  if (entry.endedAt == null) {
    return diffMinutes(entry.startedAt, nowIso);
  }

  return normalizedStoredMinutes(entry.minutes);
}

// (role: calculate actual minutes for one task on one date, type: (TimeEntry[], string, string, string)=>number)
export function totalTrackedMinutes(
  entries: TimeEntry[],
  taskId: string,
  dateYmd: string,
  nowIso: string,
): number {
  return entries
    .filter((entry) => entry.taskId === taskId && entry.date === dateYmd)
    .reduce((total, entry) => total + getTrackedMinutes(entry, nowIso), 0);
}

// (role: aggregate actual minutes by task for one date, type: (TimeEntry[], string, string)=>Map)
export function trackedMinutesByTask(
  entries: TimeEntry[],
  dateYmd: string,
  nowIso: string,
): Map<string, number> {
  const totals = new Map<string, number>();

  for (const entry of entries) {
    if (entry.date !== dateYmd) continue;

    const current = totals.get(entry.taskId) ?? 0;
    totals.set(entry.taskId, current + getTrackedMinutes(entry, nowIso));
  }

  return totals;
}
