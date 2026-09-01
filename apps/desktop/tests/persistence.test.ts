import { beforeEach, describe, expect, mock, test } from 'bun:test';

type PersistedAppData = {
  tasks: typeof validLegacyTask[];
  completions: Array<{ taskId: string; date: string }>;
  timeEntries: Array<{
    id: string;
    taskId: string;
    date: string;
    startedAt: string;
    endedAt: string | null;
    minutes: number;
  }>;
  taskDailyMemos: Array<{
    id: string;
    taskId: string;
    date: string;
    text: string;
    updatedAt: string;
  }>;
};

const storageValues = new Map<string, string>();
let databaseData: PersistedAppData = {
  tasks: [],
  completions: [],
  timeEntries: [],
  taskDailyMemos: [],
};
let migrationMarker = false;
let importCalls = 0;
let saveTaskCalls = 0;

const fakeStorage = {
  getItem: (key: string) => storageValues.get(key) ?? null,
  removeItem: (key: string) => storageValues.delete(key),
  setItem: (key: string, value: string) => storageValues.set(key, value),
};

const fakeAppDb = {
  init: async () => undefined,
  load: async () => databaseData,
  importLegacy: async (data: PersistedAppData) => {
    importCalls += 1;
    if (migrationMarker) {
      return { imported: false, skippedExistingData: false };
    }

    const hasExistingData = Object.values(databaseData).some(
      (collection) => collection.length > 0,
    );
    if (hasExistingData) {
      migrationMarker = true;
      return { imported: false, skippedExistingData: true };
    }

    databaseData = data;
    migrationMarker = true;
    return {
      imported: Object.values(data).some((collection) => collection.length > 0),
      skippedExistingData: false,
    };
  },
  saveTask: async (task: (typeof validLegacyTask) & { id: string }) => {
    saveTaskCalls += 1;
    databaseData = {
      ...databaseData,
      tasks: [
        task,
        ...databaseData.tasks.filter((candidate) => candidate.id !== task.id),
      ],
    };
  },
  setTaskActive: async () => undefined,
  deleteTask: async () => undefined,
  setCompletion: async () => undefined,
  saveTimeEntries: async () => undefined,
  saveTaskDailyMemo: async () => undefined,
  getSetting: async () => null,
  setSetting: async () => undefined,
};

mock.module('../src/infrastructure/tauri/db.ts', () => ({
  appDb: fakeAppDb,
}));

Object.assign(globalThis, {
  window: {},
  __TAURI_INTERNALS__: {},
  localStorage: fakeStorage,
});

const {
  loadAppData,
  saveTask,
} = await import('../src/infrastructure/storage/index.ts');

const validLegacyTask = {
  id: 'task-legacy',
  title: 'Migrated task',
  description: '',
  category: 'weekday' as const,
  daysOfWeek: ['Mon'] as const,
  durationMinutes: 30,
  startYmd: null,
  autoArchiveAfter: null,
  repeatCount: null,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('typed desktop persistence adapter', () => {
  beforeEach(() => {
    storageValues.clear();
    databaseData = {
      tasks: [],
      completions: [],
      timeEntries: [],
      taskDailyMemos: [],
    };
    migrationMarker = false;
    importCalls = 0;
    saveTaskCalls = 0;
  });

  test('migrates valid legacy data before removing legacy keys', async () => {
    storageValues.set(
      'dailycheck.tasks.v2',
      JSON.stringify([validLegacyTask]),
    );

    const data = await loadAppData();

    expect(data.tasks).toEqual([validLegacyTask]);
    expect(storageValues.has('dailycheck.tasks.v2')).toBe(false);
    expect(importCalls).toBe(1);
    expect(migrationMarker).toBe(true);
    expect(databaseData.tasks).toEqual([validLegacyTask]);
  });

  test('leaves corrupted legacy input untouched for recovery', async () => {
    storageValues.set('dailycheck.tasks.v2', '{not valid json');

    await loadAppData();

    expect(storageValues.get('dailycheck.tasks.v2')).toBe('{not valid json');
    expect(importCalls).toBe(0);
  });

  test('does not replace existing database data with legacy data', async () => {
    databaseData.tasks = [validLegacyTask];
    storageValues.set(
      'dailycheck.tasks.v2',
      JSON.stringify([{ ...validLegacyTask, id: 'legacy-task' }]),
    );

    const data = await loadAppData();

    expect(data.tasks).toEqual([validLegacyTask]);
    expect(storageValues.has('dailycheck.tasks.v2')).toBe(false);
    expect(importCalls).toBe(1);
  });

  test('uses a typed task command for normal writes', async () => {
    await saveTask(validLegacyTask);

    expect(saveTaskCalls).toBe(1);
    expect(databaseData.tasks).toEqual([validLegacyTask]);
  });
});
