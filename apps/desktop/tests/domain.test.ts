import { describe, expect, test } from 'bun:test';
import { useDailyCheckStore } from '../src/app/store/useDailyCheckStore';
import { toggleCompletion } from '../src/domain/completion';
import { pickWeeklySlots } from '../src/domain/schedule/scheduleLimit';
import {
  autoStopEntriesAtTarget,
  closeRunningEntries,
} from '../src/domain/timeTracking/timer';
import {
  getTrackedMinutes,
  totalTrackedMinutes,
} from '../src/domain/timeTracking';
import { diffMinutes } from '../src/shared/utils/date';
import type { Completion, Task, TimeEntry } from '../src/shared/types';
import { TimeEntrySchema } from '../src/shared/schemas';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Focus',
    description: '',
    category: 'weekday',
    daysOfWeek: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    durationMinutes: 30,
    startYmd: null,
    autoArchiveAfter: null,
    repeatCount: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('time and schedule domain contracts', () => {
  test('calculates elapsed whole minutes and clamps negative time', () => {
    expect(
      diffMinutes('2026-01-05T10:00:00.000Z', '2026-01-05T10:05:59.000Z'),
    ).toBe(5);
    expect(
      diffMinutes('2026-01-05T10:05:00.000Z', '2026-01-05T10:00:00.000Z'),
    ).toBe(0);
  });

  test('returns a safe duration for invalid timestamps', () => {
    expect(diffMinutes('not-a-timestamp', '2026-01-05T10:00:00.000Z')).toBe(0);
    expect(diffMinutes('2026-01-05T10:00:00.000Z', 'not-a-timestamp')).toBe(0);
  });

  test('rejects malformed persisted timestamps while allowing overtime', () => {
    const entry = {
      id: 'entry-1',
      taskId: 'task-1',
      date: '2026-01-05',
      startedAt: '2026-01-05T10:00:00.000Z',
      endedAt: '2026-01-06T12:00:00.000Z',
      minutes: 1_560,
    };

    expect(TimeEntrySchema.safeParse(entry).success).toBe(true);
    expect(
      TimeEntrySchema.safeParse({ ...entry, startedAt: 'invalid' }).success,
    ).toBe(false);
    expect(
      TimeEntrySchema.safeParse({ ...entry, date: '2026-02-30' }).success,
    ).toBe(false);
  });

  test('closes a running entry using timestamps even when it crosses midnight', () => {
    const entries: TimeEntry[] = [
      {
        id: 'entry-1',
        taskId: 'task-1',
        date: '2026-01-05',
        startedAt: '2026-01-05T23:50:00.000Z',
        endedAt: null,
        minutes: 0,
      },
    ];

    expect(
      closeRunningEntries(entries, '2026-01-06T00:20:00.000Z'),
    ).toEqual([
      {
        ...entries[0],
        endedAt: '2026-01-06T00:20:00.000Z',
        minutes: 30,
      },
    ]);
  });

  test('keeps actual tracked time independent from completion and planned time', () => {
    const entries: TimeEntry[] = [
      {
        id: 'entry-1',
        taskId: 'task-1',
        date: '2026-01-05',
        startedAt: '2026-01-05T10:00:00.000Z',
        endedAt: '2026-01-05T11:30:00.000Z',
        minutes: 90,
      },
    ];

    expect(getTrackedMinutes(entries[0], '2026-01-05T12:00:00.000Z')).toBe(90);
    expect(
      totalTrackedMinutes(
        entries,
        'task-1',
        '2026-01-05',
        '2026-01-05T12:00:00.000Z',
      ),
    ).toBe(90);
  });

  test('auto-stops a target reached before the current date boundary is rendered', () => {
    const result = autoStopEntriesAtTarget(
      [
        {
          id: 'entry-1',
          taskId: 'task-1',
          date: '2026-01-05',
          startedAt: '2026-01-05T23:50:00.000Z',
          endedAt: null,
          minutes: 0,
        },
      ],
      [task({ durationMinutes: 30 })],
      [],
      '2026-01-06T00:20:00.000Z',
    );

    expect(result.finishedTasks).toEqual([
      {
        taskId: 'task-1',
        title: 'Focus',
        minutes: 30,
        autoCompleted: true,
      },
    ]);
    expect(result.completions).toEqual([
      { taskId: 'task-1', date: '2026-01-05' },
    ]);
  });

  test('keeps a task from appearing before its effective start date', () => {
    expect(
      pickWeeklySlots(task({ startYmd: '2026-01-08' }), '2026-01-05', []),
    ).toEqual(['2026-01-08', '2026-01-09']);
  });

  test('preserves completed slots while applying the weekly backlog limit', () => {
    const completions: Completion[] = [
      { taskId: 'task-1', date: '2026-01-05' },
    ];

    expect(
      pickWeeklySlots(
        task({ repeatCount: 2 }),
        '2026-01-05',
        completions,
      ),
    ).toEqual(['2026-01-05', '2026-01-06']);
  });

  test('completion toggling does not duplicate or remove unrelated records', () => {
    const initial: Completion[] = [
      { taskId: 'task-1', date: '2026-01-05' },
      { taskId: 'task-2', date: '2026-01-05' },
    ];

    expect(toggleCompletion(initial, 'task-1', '2026-01-05')).toEqual([
      { taskId: 'task-2', date: '2026-01-05' },
    ]);
    expect(toggleCompletion(initial, 'task-1', '2026-01-06')).toEqual([
      ...initial,
      { taskId: 'task-1', date: '2026-01-06' },
    ]);
  });
});

describe('application completion state', () => {
  test('unchecking completion preserves tracked time for the task and date', () => {
    const timeEntries: TimeEntry[] = [
      {
        id: 'entry-1',
        taskId: 'task-1',
        date: '2026-01-05',
        startedAt: '2026-01-05T10:00:00.000Z',
        endedAt: '2026-01-05T10:30:00.000Z',
        minutes: 30,
      },
    ];

    useDailyCheckStore.setState({
      hydrated: true,
      tasks: [task()],
      completions: [{ taskId: 'task-1', date: '2026-01-05' }],
      timeEntries,
      taskDailyMemos: [],
      errorMsg: '',
    });

    useDailyCheckStore.getState().toggleToday({
      taskId: 'task-1',
      today: new Date(2026, 0, 5),
    });

    expect(useDailyCheckStore.getState().completions).toEqual([]);
    expect(useDailyCheckStore.getState().timeEntries).toEqual(timeEntries);
  });
});
