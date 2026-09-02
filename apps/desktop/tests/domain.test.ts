import { beforeEach, describe, expect, mock, test } from 'bun:test';

const calls: Array<{ command: string; request: Record<string, unknown> }> = [];

mock.module('@tauri-apps/api/core', () => ({
  invoke: async (
    command: string,
    payload: { request: Record<string, unknown> },
  ) => {
    calls.push({ command, request: payload.request });
    switch (command) {
      case 'core_visible_schedule':
        return [
          {
            taskId: 'task-1',
            dates: ['2026-01-05'],
            scheduledDates: ['2026-01-05'],
            completedDates: [],
            completionCount: 0,
          },
        ];
      case 'core_toggle_completion':
        return {
          completions: [{ taskId: 'task-1', date: '2026-01-05' }],
          autoArchived: false,
        };
      case 'core_statistics':
        return {
          week: {
            weekStart: '2026-01-05',
            totalRate: 100,
            weekdayRate: 100,
            weekendRate: 0,
            dailyRate: 0,
            customRate: 0,
          },
          weekRange: { scheduledCount: 1, completedCount: 1, rate: 100 },
          today: { scheduledCount: 1, completedCount: 1, rate: 100 },
          month: { scheduledCount: 1, completedCount: 1, rate: 100 },
          allTime: { scheduledCount: 1, completedCount: 1, rate: 100 },
          todayYmd: '2026-01-05',
          monthStartYmd: '2026-01-01',
          allStartYmd: '2026-01-05',
          weekEndYmd: '2026-01-11',
        };
      case 'core_time_totals':
        return { plannedMinutes: 30, actualMinutes: 90, byTask: [] };
      case 'core_running_task_id':
        return 'task-1';
      case 'core_start_timer':
      case 'core_stop_timer':
      case 'core_pause_timer':
      case 'core_resume_timer':
        return { timeEntries: [] };
      default:
        throw new Error(`unexpected command: ${command}`);
    }
  },
}));

Object.assign(globalThis, {
  window: {},
  __TAURI_INTERNALS__: {},
});

const {
  getCoreStatistics,
  getCoreTimeTotals,
  getRunningTaskIdWithCore,
  getVisibleScheduleSlots,
  pauseTimerWithCore,
  resumeTimerWithCore,
  startTimerWithCore,
  stopTimerWithCore,
  toggleCompletionWithCore,
} = await import('../src/infrastructure/tauri/core.ts');

const task = {
  id: 'task-1',
  title: 'Focus',
  description: '',
  category: 'weekday' as const,
  daysOfWeek: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const,
  durationMinutes: 30,
  startYmd: null,
  autoArchiveAfter: null,
  repeatCount: null,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('desktop core adapter', () => {
  beforeEach(() => calls.splice(0));

  test('sends local task and completion records to core schedule rules', async () => {
    const result = await getVisibleScheduleSlots({
      tasks: [task],
      completions: [],
      weekStartYmd: '2026-01-05',
    });

    expect(result[0]?.scheduledDates).toEqual(['2026-01-05']);
    expect(calls[0]?.command).toBe('core_visible_schedule');
    expect(
      (calls[0]?.request.tasks as Array<{ createdLocalDate: string }>)[0]
        ?.createdLocalDate,
    ).toBe('2026-01-01');
  });

  test('routes completion, statistics, time, and session operations through commands', async () => {
    await toggleCompletionWithCore({
      tasks: [task],
      completions: [],
      taskId: task.id,
      date: '2026-01-05',
    });
    await getCoreStatistics({
      tasks: [task],
      completions: [],
      weekStartYmd: '2026-01-05',
      todayYmd: '2026-01-05',
      monthStartYmd: '2026-01-01',
    });
    await getCoreTimeTotals({
      tasks: [task],
      timeEntries: [],
      dateYmd: '2026-01-05',
      nowIso: '2026-01-05T10:00:00.000Z',
      taskIds: [task.id],
    });
    await getRunningTaskIdWithCore([
      {
        id: 'session-1',
        taskId: task.id,
        date: '2026-01-05',
        startedAt: '2026-01-05T10:00:00.000Z',
        endedAt: null,
        pausedAt: '2026-01-05T10:10:00.000Z',
        activeStartedAt: null,
        accumulatedMillis: 10 * 60 * 1000,
        minutes: 10,
      },
    ]);
    expect(
      (calls[3]?.request.timeEntries as Array<Record<string, unknown>>)[0],
    ).toMatchObject({
      pausedAt: '2026-01-05T10:10:00.000Z',
      accumulatedMillis: 10 * 60 * 1000,
      pausedAtMillis: Date.parse('2026-01-05T10:10:00.000Z'),
    });
    await startTimerWithCore({
      timeEntries: [],
      sessionId: 'session-1',
      taskId: task.id,
      dateYmd: '2026-01-05',
      startedAt: '2026-01-05T10:00:00.000Z',
    });
    await stopTimerWithCore({
      timeEntries: [],
      taskId: task.id,
      dateYmd: '2026-01-05',
      endedAt: '2026-01-05T10:01:00.000Z',
    });
    await pauseTimerWithCore({
      timeEntries: [],
      taskId: task.id,
      dateYmd: '2026-01-05',
      pausedAt: '2026-01-05T10:01:00.000Z',
    });
    await resumeTimerWithCore({
      timeEntries: [],
      taskId: task.id,
      dateYmd: '2026-01-05',
      resumedAt: '2026-01-05T10:02:00.000Z',
    });

    expect(calls.map((call) => call.command)).toEqual([
      'core_toggle_completion',
      'core_statistics',
      'core_time_totals',
      'core_running_task_id',
      'core_start_timer',
      'core_stop_timer',
      'core_pause_timer',
      'core_resume_timer',
    ]);
  });
});
