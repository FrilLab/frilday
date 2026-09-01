import type { DayOfWeek } from '../../shared/types';

// Display order is presentation metadata; schedule eligibility is owned by
// frilday-core and loaded through the Tauri adapter.
export const WEEK_ORDER: DayOfWeek[] = [
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
  'Sun',
];
