import type { Completion, DayOfWeek, Task } from '../../shared/types';
import { buildWeekDates, dayOfWeek, startOfWeekMonday, toYmd } from '../../shared/utils/date';
import { isVisibleInWeek } from './scheduleLimit';

// (role: day schedule item, type: interface)
export interface DayScheduleItem {
  taskId: string; // (role: task id, type: string)
  title: string; // (role: task title, type: string)
  description?: string; // (role: task description, type: string | undefined)
  memoText?: string; // (role: daily memo text, type: string | undefined)
  durationMinutes: number; // (role: planned minutes, type: number)
  category: Task['category']; // (role: category, type: Task['category'])
  isActive: boolean; // (role: active flag, type: boolean)
}

// (role: schedule by day-of-week, type: Record)
export type WeekSchedule = Record<DayOfWeek, DayScheduleItem[]>;

// (role: fixed day order, type: DayOfWeek[])
export const WEEK_ORDER: DayOfWeek[] = [
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
  'Sun',
];

// (role: day label map, type: Record)
export const WEEK_LABEL_KO: Record<DayOfWeek, string> = {
  Mon: '월',
  Tue: '화',
  Wed: '수',
  Thu: '목',
  Fri: '금',
  Sat: '토',
  Sun: '일',
};

// (role: build week schedule view model, type: (Task[], boolean)=>WeekSchedule)
export function buildWeekSchedule(
  tasks: Task[],
  completions: Completion[],
  weekStartYmd: string,
  options?: {
    includeArchived?: boolean; // (role: include inactive tasks, type: boolean | undefined)
    getMemoText?: (taskId: string, dateYmd: string) => string | undefined;
  },
): WeekSchedule {
  const includeArchived = options?.includeArchived ?? false;
  const getMemoText = options?.getMemoText;
  const normalizedWeekStartYmd = toYmd(
    startOfWeekMonday(new Date(`${weekStartYmd}T00:00:00`)),
  );
  const weekDates = buildWeekDates(normalizedWeekStartYmd);

  // 초기화
  const base: WeekSchedule = {
    Mon: [],
    Tue: [],
    Wed: [],
    Thu: [],
    Fri: [],
    Sat: [],
    Sun: [],
  };

  const filtered = includeArchived ? tasks : tasks.filter((t) => t.isActive);

  for (const t of filtered) {
    for (const ymd of weekDates) {
      if (!isVisibleInWeek(t, ymd, normalizedWeekStartYmd, completions))
        continue;

      // 완료 여부 먼저 계산 (완료면 무조건 표시해야 하므로)
      const doneThatDay = (completions ?? []).some(
        (c) => c.taskId === t.id && c.date === ymd,
      );

      const dow = dayOfWeek(new Date(`${ymd}T00:00:00`));

      // 완료가 아니면, 기존 룰대로 "그 요일에 스케줄된 task만"
      if (!doneThatDay && !t.daysOfWeek.includes(dow)) continue;

      base[dow].push({
        taskId: t.id,
        title: t.title,
        description: t.description,
        memoText: getMemoText?.(t.id, ymd) ?? undefined,
        durationMinutes: t.durationMinutes,
        category: t.category,
        isActive: t.isActive,
      });
    }
  }

  // 보기 좋게 정렬: (1) active 먼저, (2) category, (3) title
  for (const dow of WEEK_ORDER) {
    base[dow] = [...base[dow]].sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      if (a.category !== b.category)
        return String(a.category).localeCompare(String(b.category));
      return a.title.localeCompare(b.title);
    });
  }

  return base;
}
