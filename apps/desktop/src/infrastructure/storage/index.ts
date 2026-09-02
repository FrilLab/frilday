import {
  CompletionsSchema,
  TaskDailyMemosSchema,
  TasksSchema,
  TimeEntriesSchema,
} from '../../shared/schemas';
import type {
  Completion,
  Task,
  TaskDailyMemo,
  TimeEntry,
} from '../../shared/types';
import {
  appDb,
  type PersistedAppData,
} from '../tauri/db';
import { isTauri } from '../tauri/runtime';

// These keys are persisted data identifiers. Keep them stable unless an
// explicit data migration accompanies a future rename.
const STORAGE_KEYS = {
  tasks: 'dailycheck.tasks.v2',
  completions: 'dailycheck.completions.v1',
  timeEntries: 'dailycheck.timeEntries.v1',
  taskDailyMemos: 'dailycheck.taskDailyMemos.v1',
} as const;

type LegacyCollection<T> = {
  value: T;
  valid: boolean;
};

type LegacyAppData = {
  data: PersistedAppData;
  valid: boolean;
  hasData: boolean;
};

function parseLegacyJson<T>(
  key: string,
  schema: {
    safeParse: (
      value: unknown,
    ) => { success: true; data: T } | { success: false };
  },
  fallback: T,
): LegacyCollection<T> {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) {
      return { value: fallback, valid: true };
    }

    const result = schema.safeParse(JSON.parse(raw) as unknown);
    return result.success
      ? { value: result.data, valid: true }
      : { value: fallback, valid: false };
  } catch {
    return { value: fallback, valid: false };
  }
}

function loadLegacyAppData(): LegacyAppData {
  const tasks = parseLegacyJson(STORAGE_KEYS.tasks, TasksSchema, [] as Task[]);
  const completions = parseLegacyJson(
    STORAGE_KEYS.completions,
    CompletionsSchema,
    [] as Completion[],
  );
  const timeEntries = parseLegacyJson(
    STORAGE_KEYS.timeEntries,
    TimeEntriesSchema,
    [] as TimeEntry[],
  );
  const taskDailyMemos = parseLegacyJson(
    STORAGE_KEYS.taskDailyMemos,
    TaskDailyMemosSchema,
    [] as TaskDailyMemo[],
  );

  const data = {
    tasks: tasks.value,
    completions: completions.value,
    timeEntries: timeEntries.value,
    taskDailyMemos: taskDailyMemos.value,
  };

  return {
    data,
    valid:
      tasks.valid &&
      completions.valid &&
      timeEntries.valid &&
      taskDailyMemos.valid,
    hasData:
      tasks.value.length > 0 ||
      completions.value.length > 0 ||
      timeEntries.value.length > 0 ||
      taskDailyMemos.value.length > 0,
  };
}

function clearLegacyAppData(): void {
  for (const key of Object.values(STORAGE_KEYS)) {
    localStorage.removeItem(key);
  }
}

let migrationPromise: Promise<void> | null = null;

async function migrateLegacyStorageIfNeeded(): Promise<void> {
  if (!isTauri()) return;

  const legacyData = loadLegacyAppData();
  if (!legacyData.valid) {
    console.error(
      'Legacy app data is invalid; leaving it untouched for recovery.',
    );
    return;
  }

  const result = await appDb.importLegacy(legacyData.data);
  // The Rust adapter writes the import marker only after a committed import.
  // If current SQLite data already exists, it explicitly wins over legacy data.
  if (result.imported || result.skippedExistingData || !legacyData.hasData) {
    clearLegacyAppData();
  }
}

async function ensureLegacyMigration(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = migrateLegacyStorageIfNeeded();
  }
  const pending = migrationPromise;
  try {
    await pending;
  } finally {
    if (migrationPromise === pending) migrationPromise = null;
  }
}

export async function loadAppData(): Promise<PersistedAppData> {
  if (!isTauri()) {
    return {
      tasks: [],
      completions: [],
      timeEntries: [],
      taskDailyMemos: [],
    };
  }

  await appDb.init();
  await ensureLegacyMigration();
  const data = await appDb.load();

  return {
    tasks: TasksSchema.parse(data.tasks) as Task[],
    completions: CompletionsSchema.parse(data.completions) as Completion[],
    timeEntries: TimeEntriesSchema.parse(data.timeEntries) as TimeEntry[],
    taskDailyMemos: TaskDailyMemosSchema.parse(
      data.taskDailyMemos,
    ) as TaskDailyMemo[],
  };
}

export async function saveTask(task: Task): Promise<void> {
  if (!isTauri()) return;
  await ensureLegacyMigration();
  await appDb.saveTask(task);
}

export async function setTaskActive(
  taskId: string,
  isActive: boolean,
): Promise<void> {
  if (!isTauri()) return;
  await ensureLegacyMigration();
  await appDb.setTaskActive(taskId, isActive);
}

export async function deleteTask(taskId: string): Promise<void> {
  if (!isTauri()) return;
  await ensureLegacyMigration();
  await appDb.deleteTask(taskId);
}

export async function setCompletion(
  taskId: string,
  date: string,
  completed: boolean,
): Promise<void> {
  if (!isTauri()) return;
  await ensureLegacyMigration();
  await appDb.setCompletion(taskId, date, completed);
}

export async function saveTimeEntries(entries: TimeEntry[]): Promise<void> {
  if (!isTauri()) return;
  await ensureLegacyMigration();
  await appDb.saveTimeEntries(entries);
}

export async function saveTaskDailyMemo(memo: TaskDailyMemo): Promise<void> {
  if (!isTauri()) return;
  await ensureLegacyMigration();
  await appDb.saveTaskDailyMemo(memo);
}

export async function loadTasks(): Promise<Task[]> {
  return (await loadAppData()).tasks;
}

export async function loadCompletions(): Promise<Completion[]> {
  return (await loadAppData()).completions;
}

export async function loadTimeEntries(): Promise<TimeEntry[]> {
  return (await loadAppData()).timeEntries;
}

export async function loadTaskDailyMemos(): Promise<TaskDailyMemo[]> {
  return (await loadAppData()).taskDailyMemos;
}
