import type { Completion, Task, TimeEntry } from '../../shared/types';
import { diffMinutes } from '../../shared/utils/date';

export interface AutoStopResult {
  timeEntries: TimeEntry[];
  completions: Completion[];
  finishedTasks: Array<{
    taskId: string;
    title: string;
    minutes: number;
    autoCompleted: boolean;
  }>;
}

// (role: close every active entry at one timestamp, type: (TimeEntry[], string)=>TimeEntry[])
export function closeRunningEntries(
  entries: TimeEntry[],
  endedAt: string,
): TimeEntry[] {
  return entries.map((entry) => {
    if (entry.endedAt != null) return entry;

    return {
      ...entry,
      endedAt,
      minutes: diffMinutes(entry.startedAt, endedAt),
    };
  });
}

// (role: stop entries that have reached their planned duration, type: pure timer transition)
export function autoStopEntriesAtTarget(
  entries: TimeEntry[],
  tasks: Task[],
  completions: Completion[],
  nowIso: string,
): AutoStopResult {
  const nextEntries = [...entries];
  const nextCompletions = [...completions];
  const finishedTasks: AutoStopResult['finishedTasks'] = [];

  for (let i = 0; i < nextEntries.length; i += 1) {
    const entry = nextEntries[i];
    if (!entry || entry.endedAt != null) continue;

    const task = tasks.find((candidate) => candidate.id === entry.taskId);
    if (!task) continue;

    const completedMinutes = nextEntries
      .filter(
        (candidate) =>
          candidate.taskId === entry.taskId &&
          candidate.date === entry.date &&
          candidate.endedAt != null &&
          Number.isFinite(candidate.minutes),
      )
      .reduce((total, candidate) => total + Math.max(0, candidate.minutes), 0);
    const runningMinutes = diffMinutes(entry.startedAt, nowIso);

    if (completedMinutes + runningMinutes < task.durationMinutes) continue;

    nextEntries[i] = {
      ...entry,
      endedAt: nowIso,
      minutes: runningMinutes,
    };
    let autoCompleted = false;

    if (
      !nextCompletions.some(
        (completion) =>
          completion.taskId === entry.taskId && completion.date === entry.date,
      )
    ) {
      nextCompletions.push({ taskId: entry.taskId, date: entry.date });
      autoCompleted = true;
    }

    finishedTasks.push({
      taskId: entry.taskId,
      title: task.title,
      minutes: runningMinutes,
      autoCompleted,
    });
  }

  return { timeEntries: nextEntries, completions: nextCompletions, finishedTasks };
}
