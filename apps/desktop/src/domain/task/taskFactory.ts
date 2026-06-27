import type { Category, DayOfWeek, Task } from '../../shared/types';
import { FIXED_DAYS } from '../schedule';

export function createTaskEntity(args: {
  id: string; // (role: task id, type: string)
  title: string; // (role: title, type: string)
  description?: string; // (role: persistent description, type: string | undefined)
  category: Category; // (role: schedule category, type: Category)
  customDays?: DayOfWeek[]; // (role: custom days, type: DayOfWeek[] | undefined)
  durationMinutes: number; // (role: planned minutes, type: number)
  startYmd?: string | null; // (role: first eligible date YYYY-MM-DD, type: string | null | undefined)
  autoArchiveAfter?: number | null; // (role: auto archive threshold, type: number | null | undefined)
  repeatCount?: number | null; // (role: weekly max occurrences, type: number | null | undefined)
  nowIso: string; // (role: created timestamp, type: ISO string)
}): Task {
  const title = args.title.trim();
  if (!title) throw new Error('Title is required.');

  const description = (args.description ?? '').trim();

  const durationMinutes = Math.max(1, Math.floor(args.durationMinutes || 0));
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw new Error('Duration must be a positive number (minutes).');
  }

  const autoArchiveAfterRaw = args.autoArchiveAfter;
  const autoArchiveAfterNum =
    autoArchiveAfterRaw == null ? null : Number(autoArchiveAfterRaw);
  const autoArchiveAfter =
    autoArchiveAfterNum == null ||
    !Number.isInteger(autoArchiveAfterNum) ||
    autoArchiveAfterNum < 1
      ? null
      : autoArchiveAfterNum;

  const startYmdRaw = args.startYmd == null ? null : String(args.startYmd);
  const startYmd =
    startYmdRaw == null || startYmdRaw.trim() === ''
      ? null
      : /^\d{4}-\d{2}-\d{2}$/.test(startYmdRaw.trim())
        ? startYmdRaw.trim()
        : null;

  const repeatCountRaw = args.repeatCount;
  const repeatCountNum = repeatCountRaw == null ? null : Number(repeatCountRaw);
  const repeatCount =
    repeatCountNum == null ||
    !Number.isInteger(repeatCountNum) ||
    repeatCountNum < 1
      ? null
      : repeatCountNum;

  let daysOfWeek: readonly DayOfWeek[];

  if (args.category === 'custom') {
    const days = (args.customDays ?? []).filter(Boolean);
    if (days.length === 0) throw new Error('Pick at least one day for custom.');
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
    autoArchiveAfter,
    repeatCount,
    isActive: true,
    createdAt: args.nowIso,
  };
}
