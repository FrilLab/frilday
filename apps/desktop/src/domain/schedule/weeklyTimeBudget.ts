import type { Completion, DayOfWeek, Task } from '../../shared/types';
import { WEEK_ORDER } from './scheduleView';

export const OVERLOADED_DAY_MINUTES = 8 * 60;

export type WeeklyPlanProjection = {
  id: string;
  routineId: string | null;
  date: string;
  baselineDurationMinutes: number;
  plannedDurationMinutes: number;
  durationOverrideMinutes: number | null;
  status: 'planned' | 'skipped' | 'moved';
  effectiveDate: string;
  movedToYmd: string | null;
  executable: boolean;
};

export type WeeklyScheduleSlot = {
  taskId: string;
  plans?: readonly WeeklyPlanProjection[];
};

export type WeeklyPlanItem = {
  task: Task;
  plan: WeeklyPlanProjection;
  dateYmd: string;
  completed: boolean;
  memoText?: string;
};

export type WeeklyDayBudget = {
  day: DayOfWeek;
  dateYmd: string;
  plans: WeeklyPlanItem[];
  plannedMinutes: number;
  skippedMinutes: number;
  completedCount: number;
  overloaded: boolean;
};

function isCompletionForPlan(
  completions: Completion[],
  item: WeeklyPlanItem,
): boolean {
  return completions.some(
    (completion) =>
      completion.planId === item.plan.id ||
      (completion.planId == null &&
        completion.taskId === item.task.id &&
        completion.date === item.dateYmd),
  );
}

/**
 * Convert core's schedule projection into the seven day buckets used by the
 * weekly planner. Skipped Plans remain in their day bucket for visibility,
 * but never contribute to the executable time budget.
 */
export function buildWeeklyTimeBudget(input: {
  tasks: Task[];
  scheduleSlots: readonly WeeklyScheduleSlot[];
  weekDates: readonly string[];
  completions: Completion[];
  getMemoText?: (taskId: string, date: string) => string;
}): WeeklyDayBudget[] {
  const slotsByTask = new Map(
    input.scheduleSlots.map((slot) => [slot.taskId, slot]),
  );

  return input.weekDates.slice(0, 7).map((dateYmd, index) => {
    const day = WEEK_ORDER[index] ?? 'Sun';
    const plans = input.tasks
      .flatMap((task) => {
        const slot = slotsByTask.get(task.id);
        return (slot?.plans ?? [])
          .filter((plan) => plan.effectiveDate === dateYmd)
          .map((plan) => {
            const item: WeeklyPlanItem = {
              task,
              plan,
              dateYmd,
              completed: false,
              memoText: input.getMemoText?.(task.id, dateYmd) || undefined,
            };
            return {
              ...item,
              completed: isCompletionForPlan(input.completions, item),
            };
          });
      })
      .sort((left, right) => {
        if (left.plan.executable !== right.plan.executable) {
          return left.plan.executable ? -1 : 1;
        }
        if (
          left.plan.plannedDurationMinutes !==
          right.plan.plannedDurationMinutes
        ) {
          return right.plan.plannedDurationMinutes - left.plan.plannedDurationMinutes;
        }
        if (left.task.category !== right.task.category) {
          return left.task.category.localeCompare(right.task.category);
        }
        return left.task.title.localeCompare(right.task.title);
      });

    const plannedMinutes = plans.reduce(
      (total, item) =>
        total + (item.plan.executable ? item.plan.plannedDurationMinutes : 0),
      0,
    );
    const skippedMinutes = plans.reduce(
      (total, item) =>
        total + (item.plan.executable ? 0 : item.plan.plannedDurationMinutes),
      0,
    );

    return {
      day,
      dateYmd,
      plans,
      plannedMinutes,
      skippedMinutes,
      completedCount: plans.filter((item) => item.completed).length,
      overloaded: plannedMinutes >= OVERLOADED_DAY_MINUTES,
    };
  });
}

export function totalPlannedMinutes(days: WeeklyDayBudget[]): number {
  return days.reduce((total, day) => total + day.plannedMinutes, 0);
}
