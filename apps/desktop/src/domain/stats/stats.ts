import type { Completion, DayOfWeek, Task } from '../../shared/types';
import { buildWeekDates } from '../../shared/utils/date';
import { isDoneOn } from '../completion';

export interface WeekStats {
  weekStart: string; // (role: week start YYYY-MM-DD, type: string)
  totalRate: number; // (role: % 0..100, type: number)
  weekdayRate: number;
  weekendRate: number;
  dailyRate: number;
  customRate: number;
}

function completedInWeek(
  task: Task, // (role: task, type: Task)
  completions: Completion[], // (role: completion logs, type: Completion[])
  weekDates: string[], // (role: YYYY-MM-DD[] in week, type: string[])
): boolean {
  const dateSet = new Set(weekDates);
  return completions.some((c) => c.taskId === task.id && dateSet.has(c.date));
}

export function calcWeekStats(
  tasks: Task[], // (role: all tasks, type: Task[])
  completions: Completion[], // (role: completion logs, type: Completion[])
  weekStart: string, // (role: week start YYYY-MM-DD, type: string)
): WeekStats {
  const weekDates = buildWeekDates(weekStart);
  const active = tasks.filter((t) => t.isActive);

  const rateFor = (subset: Task[]) => {
    if (subset.length === 0) return 0;
    const done = subset.filter((t) =>
      completedInWeek(t, completions, weekDates),
    ).length;
    return (done * 100) / subset.length;
  };

  return {
    weekStart,
    totalRate: rateFor(active),
    weekdayRate: rateFor(active.filter((t) => t.category === 'weekday')),
    weekendRate: rateFor(active.filter((t) => t.category === 'weekend')),
    dailyRate: rateFor(active.filter((t) => t.category === 'daily')),
    customRate: rateFor(active.filter((t) => t.category === 'custom')),
  };
}

export interface TodayStats {
  scheduledCount: number; // (role: tasks scheduled today, type: number)
  doneCount: number; // (role: tasks completed today, type: number)
  rate: number; // (role: completion rate 0..100, type: number)
}

export function calcTodayStats(
  tasks: Task[], // (role: all tasks, type: Task[])
  completions: Completion[], // (role: completion logs, type: Completion[])
  todayYmd: string, // (role: YYYY-MM-DD, type: string)
  todayDow: DayOfWeek, // (role: day-of-week, type: DayOfWeek)
): TodayStats {
  const scheduled = tasks.filter(
    (t) => t.isActive && t.daysOfWeek.includes(todayDow),
  );
  const done = scheduled.filter((t) => isDoneOn(completions, t.id, todayYmd));

  const scheduledCount = scheduled.length;
  const doneCount = done.length;
  const rate = scheduledCount === 0 ? 0 : (doneCount * 100) / scheduledCount;

  return { scheduledCount, doneCount, rate };
}
