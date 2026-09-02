import { describe, expect, test } from 'bun:test';
import {
  createTaskEntity,
  updateTaskEntity,
} from '../src/domain/task/taskFactory';

const baseInput = {
  id: 'routine-1',
  title: 'English study',
  description: 'Vocabulary review',
  category: 'weekday' as const,
  durationMinutes: 45,
  startYmd: '2026-01-05',
  completionLimit: 3,
  occurrenceLimit: 10,
  nowIso: '2026-01-01T08:00:00.000Z',
};

describe('routine factory', () => {
  test('rejects invalid routine defaults below the form layer', () => {
    expect(() =>
      createTaskEntity({ ...baseInput, durationMinutes: -10 }),
    ).toThrow('Default planned duration');
    expect(() =>
      createTaskEntity({ ...baseInput, startYmd: '2026-02-30' }),
    ).toThrow('valid calendar date');
    expect(() =>
      createTaskEntity({ ...baseInput, occurrenceLimit: 0 }),
    ).toThrow('Occurrence limit');
  });

  test('normalizes routine text and retains recurring defaults', () => {
    const routine = createTaskEntity({
      ...baseInput,
      title: '  English study  ',
      description: '  Vocabulary review  ',
      category: 'custom',
      customDays: ['Tue', 'Thu'],
    });

    expect(routine).toMatchObject({
      title: 'English study',
      description: 'Vocabulary review',
      durationMinutes: 45,
      daysOfWeek: ['Tue', 'Thu'],
      completionLimit: 3,
      occurrenceLimit: 10,
      isActive: true,
    });
  });

  test('updates only routine defaults and preserves identity/state', () => {
    const current = {
      ...createTaskEntity(baseInput),
      isActive: false,
    };
    const updated = updateTaskEntity(current, {
      title: 'Rust study',
      description: 'Read one chapter',
      category: 'daily',
      durationMinutes: 60,
      startYmd: null,
      completionLimit: null,
      occurrenceLimit: 20,
    });

    expect(updated).toMatchObject({
      id: current.id,
      createdAt: current.createdAt,
      isActive: false,
      title: 'Rust study',
      category: 'daily',
      durationMinutes: 60,
      completionLimit: null,
      occurrenceLimit: 20,
    });
    expect(current.title).toBe('English study');
    expect(current.durationMinutes).toBe(45);
  });
});
