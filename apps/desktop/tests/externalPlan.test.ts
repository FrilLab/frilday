import { describe, expect, test } from 'bun:test';
import type { Plan } from '../src/shared/types';
import {
  externalPlanToTask,
  planIsExecutable,
} from '../src/domain/plan/externalPlan';

function importedPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'external-plan:google:event-1',
    routineId: null,
    title: 'Rust study',
    date: '2026-09-23',
    baselineDurationMinutes: 90,
    durationOverrideMinutes: null,
    status: 'planned',
    movedToYmd: null,
    source: {
      kind: 'externalCalendar',
      providerId: 'google',
      calendarId: 'primary',
      eventId: 'event-1',
      occurrenceId: null,
      availability: 'present',
    },
    ...overrides,
  };
}

describe('external Plan UI projection', () => {
  test('keeps source identity and exposes an executable date task', () => {
    const plan = importedPlan();
    const task = externalPlanToTask(plan);

    expect(planIsExecutable(plan)).toBe(true);
    expect(task?.id).toBe(plan.id);
    expect(task?.title).toBe('Rust study');
    expect(task?.durationMinutes).toBe(90);
    expect(task?.source).toEqual(plan.source);
  });

  test('keeps unavailable source records visible without making them executable', () => {
    const plan = importedPlan({
      source: {
        ...importedPlan().source!,
        availability: 'unavailable',
      },
    });
    expect(planIsExecutable(plan)).toBe(false);
    expect(externalPlanToTask(plan)?.isActive).toBe(false);
  });
});
