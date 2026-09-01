import { describe, expect, test } from 'bun:test';
import {
  getActiveTimerViewModel,
  getTrackedElapsedSeconds,
} from '../src/features/timer/activeTimerModel';

describe('active timer view model', () => {
  test('renders ready with the planned duration as the dominant value', () => {
    const view = getActiveTimerViewModel({
      phase: 'ready',
      plannedMinutes: 30,
      actualElapsedSeconds: 0,
    });

    expect(view.status).toBe('ready');
    expect(view.displaySeconds).toBe(1800);
    expect(view.remainingSeconds).toBe(1800);
    expect(view.progressRatio).toBe(0);
  });

  test('keeps running progress based on timestamp-derived actual time', () => {
    const view = getActiveTimerViewModel({
      phase: 'running',
      plannedMinutes: 30,
      actualElapsedSeconds: 12 * 60 + 15,
    });

    expect(view.status).toBe('running');
    expect(view.displaySeconds).toBe(17 * 60 + 45);
    expect(view.actualSeconds).toBe(12 * 60 + 15);
    expect(view.progressRatio).toBeCloseTo(0.4083, 4);
  });

  test('switches to overtime without capping actual time', () => {
    const view = getActiveTimerViewModel({
      phase: 'running',
      plannedMinutes: 30,
      actualElapsedSeconds: 35 * 60 + 12,
    });

    expect(view.status).toBe('overtime');
    expect(view.targetReached).toBe(true);
    expect(view.displaySeconds).toBe(5 * 60 + 12);
    expect(view.actualSeconds).toBe(35 * 60 + 12);
    expect(view.progressRatio).toBe(1);
  });

  test('keeps paused values stable and exposes the remaining target', () => {
    const view = getActiveTimerViewModel({
      phase: 'paused',
      plannedMinutes: 30,
      actualElapsedSeconds: 10 * 60,
    });

    expect(view.status).toBe('paused');
    expect(view.displaySeconds).toBe(20 * 60);
    expect(view.actualSeconds).toBe(10 * 60);
  });

  test('keeps overtime visible when a target-reaching session is paused', () => {
    const view = getActiveTimerViewModel({
      phase: 'paused',
      plannedMinutes: 30,
      actualElapsedSeconds: 35 * 60 + 12,
    });

    expect(view.status).toBe('paused');
    expect(view.targetReached).toBe(true);
    expect(view.displaySeconds).toBe(5 * 60 + 12);
  });

  test('shows committed actual duration in the finished state', () => {
    const view = getActiveTimerViewModel({
      phase: 'finished',
      plannedMinutes: 30,
      actualElapsedSeconds: 42 * 60,
    });

    expect(view.status).toBe('finished');
    expect(view.displaySeconds).toBe(42 * 60);
    expect(view.targetReached).toBe(true);
  });
});

describe('tracked timer elapsed time', () => {
  test('derives running and paused segments from timestamps', () => {
    const elapsed = getTrackedElapsedSeconds(
      [
        {
          id: 'first',
          taskId: 'task-1',
          date: '2026-01-05',
          startedAt: '2026-01-05T10:00:00.000Z',
          endedAt: '2026-01-05T10:05:30.000Z',
          minutes: 5,
        },
        {
          id: 'second',
          taskId: 'task-1',
          date: '2026-01-05',
          startedAt: '2026-01-05T10:10:00.000Z',
          endedAt: null,
          minutes: 0,
        },
      ],
      'task-1',
      '2026-01-05T10:12:15.000Z',
      '2026-01-05',
    );

    expect(elapsed).toBe(7 * 60 + 45);
  });
});
