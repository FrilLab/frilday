import { beforeEach, describe, expect, mock, test } from 'bun:test';

const calls: Array<{ command: string; payload: unknown }> = [];

mock.module('@tauri-apps/api/core', () => ({
  invoke: async (command: string, payload?: unknown) => {
    calls.push({ command, payload });
    return command === 'load_app_data'
      ? {
          tasks: [],
          completions: [],
          timeEntries: [],
          taskDailyMemos: [],
        }
      : command === 'get_setting' || command === 'get_migration_marker'
        ? null
        : undefined;
  },
}));

Object.assign(globalThis, {
  window: {},
  __TAURI_INTERNALS__: {},
});

const { appDb } = await import('../src/infrastructure/tauri/db.ts');

describe('Tauri persistence boundary', () => {
  beforeEach(() => calls.splice(0));

  test('exposes typed domain operations instead of SQL execution', async () => {
    await appDb.init();
    await appDb.load();
    await appDb.saveTask({
      id: 'task-1',
      title: 'Focus',
      description: '',
      category: 'daily',
      daysOfWeek: ['Mon'],
      durationMinutes: 30,
      startYmd: null,
      completionLimit: null,
      occurrenceLimit: null,
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await appDb.setCompletion('task-1', '2026-01-05', true);
    await appDb.saveTimeEntries([]);
    await appDb.saveTaskDailyMemo({
      id: 'task-1_2026-01-05',
      taskId: 'task-1',
      date: '2026-01-05',
      text: 'Note',
      updatedAt: '2026-01-05T10:00:00.000Z',
    });

    expect(calls.map((call) => call.command)).toEqual([
      'initialize_app_database',
      'load_app_data',
      'save_task',
      'set_completion',
      'save_time_entries',
      'save_task_daily_memo',
    ]);
    expect(calls.some((call) => call.command.includes('sql'))).toBe(false);
  });
});
