import type { Category, DayOfWeek, Task } from '../../shared/types';
import { FIXED_DAYS } from '../schedule';
import { isValidYmd, toYmd } from '../../shared/utils/date';

function normalizePositiveInteger(
  value: number | string | null | undefined,
  field: string,
): number | null {
  if (value == null || (typeof value === 'string' && value.trim() === '')) {
    return null;
  }

  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 1) {
    throw new Error(`${field} must be a positive whole number.`);
  }

  return numberValue;
}

function normalizeStartYmd(
  value: string | null | undefined,
  createdAt: string,
): string | null {
  const startYmd = value == null || value.trim() === '' ? null : value.trim();
  if (startYmd == null) return null;
  if (!isValidYmd(startYmd)) {
    throw new Error('Start date must be a valid calendar date.');
  }

  const createdAtDate = new Date(createdAt);
  if (!Number.isFinite(createdAtDate.getTime())) {
    throw new Error('Created date must be a valid timestamp.');
  }

  const createdAtYmd = toYmd(createdAtDate);
  if (startYmd < createdAtYmd) {
    throw new Error('Start date cannot be earlier than created date.');
  }

  return startYmd;
}

export function createTaskEntity(args: {
  id: string; // (role: task id, type: string)
  title: string; // (role: title, type: string)
  description?: string; // (role: persistent description, type: string | undefined)
  category: Category; // (role: schedule category, type: Category)
  customDays?: DayOfWeek[]; // (role: custom days, type: DayOfWeek[] | undefined)
  durationMinutes: number; // (role: planned minutes, type: number)
  startYmd?: string | null; // (role: first eligible date YYYY-MM-DD, type: string | null | undefined)
  completionLimit?: number | null; // (role: completion limit, type: number | null | undefined)
  occurrenceLimit?: number | null; // (role: lifetime occurrence limit, type: number | null | undefined)
  nowIso: string; // (role: created timestamp, type: ISO string)
}): Task {
  if (!args.id.trim()) throw new Error('Routine id is required.');

  const title = args.title.trim();
  if (!title) throw new Error('Title is required.');
  if (title.length > 80) throw new Error('Title is too long (max 80 characters).');

  const description = (args.description ?? '').trim();
  if (description.length > 2000) {
    throw new Error('Description is too long (max 2000 characters).');
  }

  if (!['weekday', 'weekend', 'daily', 'custom'].includes(args.category)) {
    throw new Error('Invalid recurrence rule.');
  }

  const createdAtDate = new Date(args.nowIso);
  if (!Number.isFinite(createdAtDate.getTime())) {
    throw new Error('Created date must be a valid timestamp.');
  }

  const durationMinutes = Number(args.durationMinutes);
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 1 ||
    durationMinutes > 720
  ) {
    throw new Error('Default planned duration must be a whole number from 1 to 720 minutes.');
  }

  const completionLimit = normalizePositiveInteger(
    args.completionLimit,
    'Completion limit',
  );
  const startYmd = normalizeStartYmd(
    args.startYmd == null ? null : String(args.startYmd),
    args.nowIso,
  );
  const occurrenceLimit = normalizePositiveInteger(
    args.occurrenceLimit,
    'Occurrence limit',
  );

  let daysOfWeek: readonly DayOfWeek[];

  if (args.category === 'custom') {
    const days = (args.customDays ?? []).filter(Boolean);
    if (days.length === 0) throw new Error('Pick at least one day for custom.');
    if (days.some((day) => !['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].includes(day))) {
      throw new Error('Invalid recurrence day.');
    }
    daysOfWeek = [...new Set(days)];
  } else {
    daysOfWeek = FIXED_DAYS[args.category];
  }

  return {
    id: args.id,
    title,
    description,
    category: args.category,
    daysOfWeek,
    durationMinutes,
    startYmd,
    completionLimit,
    occurrenceLimit,
    isActive: true,
    createdAt: args.nowIso,
  };
}

export function updateTaskEntity(
  current: Task,
  args: Omit<Parameters<typeof createTaskEntity>[0], 'id' | 'nowIso'>,
): Task {
  const next = createTaskEntity({
    ...args,
    id: current.id,
    nowIso: current.createdAt,
  });

  return {
    ...next,
    isActive: current.isActive,
    createdAt: current.createdAt,
  };
}
