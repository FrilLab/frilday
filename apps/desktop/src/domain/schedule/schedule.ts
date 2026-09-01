import type { Category, DayOfWeek } from '../../shared/types';

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
