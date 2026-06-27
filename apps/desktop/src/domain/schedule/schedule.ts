import type { Category, DayOfWeek, Task } from '../../shared/types';

export const ALL_DAYS: DayOfWeek[] = [
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
  'Sun',
];

export const FIXED_DAYS: Record<
  Exclude<Category, 'custom'>,
  readonly DayOfWeek[]
> = {
  weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  weekend: ['Sat', 'Sun'],
  daily: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
};

// (role: check if task scheduled on given day, type: (Task, DayOfWeek) => boolean)
export function isScheduledOn(task: Task, dow: DayOfWeek): boolean {
  return task.daysOfWeek.includes(dow);
}
