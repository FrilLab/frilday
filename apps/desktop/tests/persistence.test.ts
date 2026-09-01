import { beforeEach, describe, expect, mock, test } from 'bun:test';

type FakeStorage = {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
};

const storageValues = new Map<string, string>();
const executedSql: string[] = [];
const transactions: string[][] = [];
let migrationMarker = '0';
let failWrites = false;
let openTransactions = 0;
let maxOpenTransactions = 0;
let committedTransactions = 0;
let rolledBackTransactions = 0;

const fakeStorage: FakeStorage = {
  getItem: (key) => storageValues.get(key) ?? null,
  removeItem: (key) => storageValues.delete(key),
  setItem: (key, value) => storageValues.set(key, value),
};

const fakeAppDb = {
  init: async () => undefined,
  execute: async (sql: string) => {
    executedSql.push(sql.trim());
    if (sql.includes('INSERT INTO app_meta')) migrationMarker = '1';
    await new Promise((resolve) => setTimeout(resolve, 0));
  },
  executeTransaction: async (
    statements: Array<{ sql: string; bind: unknown[] }>,
  ) => {
    const sqlStatements = statements.map(({ sql }) => sql.trim());
    transactions.push(sqlStatements);
    openTransactions += 1;
    maxOpenTransactions = Math.max(maxOpenTransactions, openTransactions);

    try {
      for (const sql of sqlStatements) {
        executedSql.push(sql);
        if (failWrites && sql.includes('INSERT INTO tasks')) {
          throw new Error('simulated write failure');
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      committedTransactions += 1;
    } catch (error) {
      rolledBackTransactions += 1;
      throw error;
    } finally {
      openTransactions -= 1;
    }
  },
  select: async <T>(sql: string): Promise<T[]> => {
    if (sql.includes('SELECT value FROM app_meta')) {
      return migrationMarker === '1'
        ? ([{ value: '1' }] as T[])
        : ([] as T[]);
    }
    if (sql.includes('COUNT(*)')) return [{ count: 0 }] as T[];
    return [] as T[];
  },
};

mock.module('../src/infrastructure/tauri/db.ts', () => ({
  appDb: fakeAppDb,
}));

Object.assign(globalThis, {
  window: {},
  __TAURI_INTERNALS__: {},
  localStorage: fakeStorage,
});

const { loadAppData, replaceAllAppData } = await import(
  '../src/infrastructure/storage/index.ts'
);

const validLegacyTask = {
  id: 'task-legacy',
  title: 'Migrated task',
  description: '',
  category: 'weekday',
  daysOfWeek: ['Mon'],
  durationMinutes: 30,
  startYmd: null,
  autoArchiveAfter: null,
  repeatCount: null,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('SQLite persistence safety', () => {
  beforeEach(() => {
    storageValues.clear();
    executedSql.length = 0;
    transactions.length = 0;
    migrationMarker = '0';
    failWrites = false;
    openTransactions = 0;
    maxOpenTransactions = 0;
    committedTransactions = 0;
    rolledBackTransactions = 0;
  });

  test('migrates valid legacy data before removing legacy keys', async () => {
    storageValues.set(
      'dailycheck.tasks.v2',
      JSON.stringify([validLegacyTask]),
    );

    const data = await loadAppData();

    expect(data.tasks).toEqual([]);
    expect(storageValues.has('dailycheck.tasks.v2')).toBe(false);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toContain('DELETE FROM tasks');
    expect(transactions[0].some((sql) => sql.includes('INSERT INTO tasks'))).toBe(
      true,
    );

    const callsAfterFirstLoad = executedSql.length;
    await loadAppData();
    expect(executedSql.length).toBe(callsAfterFirstLoad);
  });

  test('leaves corrupted legacy input untouched for recovery', async () => {
    storageValues.set('dailycheck.tasks.v2', '{not valid json');

    await loadAppData();

    expect(storageValues.get('dailycheck.tasks.v2')).toBe('{not valid json');
    expect(executedSql).not.toContain('DELETE FROM tasks');
  });

  test('wraps a complete snapshot in one transaction', async () => {
    await replaceAllAppData({
      tasks: [],
      completions: [],
      timeEntries: [],
      taskDailyMemos: [],
    });

    expect(transactions).toEqual([
      [
        'DELETE FROM tasks',
        'DELETE FROM completions',
        'DELETE FROM time_entries',
        'DELETE FROM task_daily_memos',
      ],
    ]);
    expect(committedTransactions).toBe(1);
  });

  test('rolls back when a snapshot write fails', async () => {
    failWrites = true;

    await expect(
      replaceAllAppData({
        tasks: [validLegacyTask],
        completions: [],
        timeEntries: [],
        taskDailyMemos: [],
      }),
    ).rejects.toThrow('simulated write failure');

    expect(transactions).toHaveLength(1);
    expect(rolledBackTransactions).toBe(1);
    expect(committedTransactions).toBe(0);
  });

  test('serializes concurrent snapshot saves', async () => {
    await Promise.all([
      replaceAllAppData({
        tasks: [],
        completions: [],
        timeEntries: [],
        taskDailyMemos: [],
      }),
      replaceAllAppData({
        tasks: [],
        completions: [],
        timeEntries: [],
        taskDailyMemos: [],
      }),
    ]);

    expect(maxOpenTransactions).toBe(1);
  });
});
