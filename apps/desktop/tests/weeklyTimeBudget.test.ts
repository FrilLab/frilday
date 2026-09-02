import { describe, expect, test } from 'bun:test';
import {
  buildWeeklyTimeBudget,
  canAdjustPlanDate,
  totalPlannedMinutes,
  type WeeklyPlanProjection,
  type WeeklyScheduleSlot,
} from '../src/domain/schedule/weeklyTimeBudget';

const task = {
  id: 'task-focus',
  title: 'Focus',
  description: '',
  category: 'weekday' as const,
  daysOfWeek: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const,
  durationMinutes: 30,
  startYmd: null,
  completionLimit: null,
  occurrenceLimit: null,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function plan(
  overrides: Partial<WeeklyPlanProjection> = {},
): WeeklyPlanProjection {
  return {
    id: 'routine-plan:11:task-focus:2026-01-05',
    routineId: task.id,
    date: '2026-01-05',
    baselineDurationMinutes: 30,
    durationOverrideMinutes: null,
    status: 'planned',
    movedToYmd: null,
    plannedDurationMinutes: 30,
    effectiveDate: '2026-01-05',
    executable: true,
    ...overrides,
  };
}

function slot(plans: WeeklyPlanProjection[]): WeeklyScheduleSlot {
  return {
    taskId: task.id,
    dates: plans
      .filter((candidate) => candidate.executable)
      .map((candidate) => candidate.effectiveDate),
    scheduledDates: [],
    completedDates: [],
    completionCount: 0,
    plans,
  };
}

const weekDates = [
  '2026-01-05',
  '2026-01-06',
  '2026-01-07',
  '2026-01-08',
  '2026-01-09',
  '2026-01-10',
  '2026-01-11',
];

describe('weekly time budget projection', () => {
  test('allows Plan adjustments only for today and future dates', () => {
    expect(canAdjustPlanDate('2026-01-04', '2026-01-05')).toBe(false);
    expect(canAdjustPlanDate('2026-01-05', '2026-01-05')).toBe(true);
    expect(canAdjustPlanDate('2026-01-06', '2026-01-05')).toBe(true);
  });

  test('sums effective Plan durations by day and across the week', () => {
    const days = buildWeeklyTimeBudget({
      tasks: [task],
      scheduleSlots: [
        slot([
          plan({ plannedDurationMinutes: 90 }),
          plan({
            id: 'routine-plan:11:task-focus:2026-01-06',
            date: '2026-01-06',
            effectiveDate: '2026-01-06',
            plannedDurationMinutes: 45,
            durationOverrideMinutes: 45,
          }),
        ]),
      ],
      weekDates,
      completions: [],
    });

    expect(days[0]?.plannedMinutes).toBe(90);
    expect(days[1]?.plannedMinutes).toBe(45);
    expect(days[0]?.plans[0]?.plan.plannedDurationMinutes).toBe(90);
    expect(totalPlannedMinutes(days)).toBe(135);
  });

  test('keeps skipped Plans visible while excluding them from time totals', () => {
    const skipped = plan({
      status: 'skipped',
      executable: false,
      plannedDurationMinutes: 120,
    });
    const days = buildWeeklyTimeBudget({
      tasks: [task],
      scheduleSlots: [slot([skipped])],
      weekDates,
      completions: [],
    });

    expect(days[0]?.plans).toHaveLength(1);
    expect(days[0]?.skippedMinutes).toBe(120);
    expect(days[0]?.plannedMinutes).toBe(0);
    expect(totalPlannedMinutes(days)).toBe(0);
  });

  test('recognises both stable Plan completions and legacy task-date completions', () => {
    const current = plan({ plannedDurationMinutes: 60 });
    const legacy = plan({
      id: 'routine-plan:11:task-focus:2026-01-06',
      date: '2026-01-06',
      effectiveDate: '2026-01-06',
    });
    const days = buildWeeklyTimeBudget({
      tasks: [task],
      scheduleSlots: [slot([current, legacy])],
      weekDates,
      completions: [
        { taskId: task.id, planId: current.id, date: current.effectiveDate },
        { taskId: task.id, date: legacy.effectiveDate },
      ],
    });

    expect(days[0]?.completedCount).toBe(1);
    expect(days[1]?.completedCount).toBe(1);
  });
});
