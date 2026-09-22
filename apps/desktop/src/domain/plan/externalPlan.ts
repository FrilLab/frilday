import type { DayOfWeek, Plan, Task } from '../../shared/types';
import { dayOfWeek } from '../../shared/utils/date';

export function isExternalPlan(plan: Plan): boolean {
  return plan.source?.kind === 'externalCalendar' && plan.routineId == null;
}

export function isExternalTask(task: Task): boolean {
  return task.source?.kind === 'externalCalendar';
}

export function effectivePlanDate(plan: Plan): string {
  return plan.status === 'moved' ? plan.movedToYmd ?? plan.date : plan.date;
}

export function planIsExecutable(plan: Plan): boolean {
  return (
    isExternalPlan(plan) &&
    plan.status !== 'skipped' &&
    plan.source?.availability === 'present'
  );
}

export function externalPlanToTask(
  plan: Plan,
  fallbackTitle = 'Imported calendar event',
): Task | null {
  if (!isExternalPlan(plan)) return null;

  const date = effectivePlanDate(plan);
  const source = plan.source!;
  const durationMinutes =
    plan.durationOverrideMinutes ?? plan.baselineDurationMinutes;
  const localDate = new Date(`${date}T00:00:00`);
  const weekday: DayOfWeek = dayOfWeek(localDate);

  return {
    id: plan.id,
    title: plan.title?.trim() || fallbackTitle,
    description: '',
    category: 'custom',
    daysOfWeek: [weekday],
    durationMinutes,
    startYmd: date,
    completionLimit: null,
    occurrenceLimit: null,
    isActive: planIsExecutable(plan),
    createdAt: `${date}T00:00:00.000Z`,
    source,
  };
}
