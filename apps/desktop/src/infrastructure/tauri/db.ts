import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './runtime';
import type {
  Completion,
  Task,
  TaskDailyMemo,
  TimeEntry,
} from '../../shared/types';

export type PersistedAppData = {
  tasks: Task[];
  completions: Completion[];
  timeEntries: TimeEntry[];
  taskDailyMemos: TaskDailyMemo[];
};

type LegacyMigrationOutput = {
  imported: boolean;
  skippedExistingData: boolean;
};

async function invokePersistence<T>(
  command: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri()) {
    throw new Error('Desktop persistence is unavailable in web runtime.');
  }
  return invoke<T>(command, payload);
}

async function init(): Promise<void> {
  await invokePersistence<void>('initialize_app_database');
}

async function load(): Promise<PersistedAppData> {
  return invokePersistence<PersistedAppData>('load_app_data');
}

async function importLegacy(
  data: PersistedAppData,
): Promise<LegacyMigrationOutput> {
  return invokePersistence<LegacyMigrationOutput>('import_legacy_app_data', {
    data,
  });
}

async function saveTask(task: Task): Promise<void> {
  return invokePersistence<void>('save_task', { task });
}

async function setTaskActive(taskId: string, isActive: boolean): Promise<void> {
  return invokePersistence<void>('set_task_active', {
    request: { taskId, isActive },
  });
}

async function deleteTask(taskId: string): Promise<void> {
  return invokePersistence<void>('delete_task', { taskId });
}

async function setCompletion(
  taskId: string,
  date: string,
  completed: boolean,
): Promise<void> {
  return invokePersistence<void>('set_completion', {
    request: { taskId, date, completed },
  });
}

async function saveTimeEntries(entries: TimeEntry[]): Promise<void> {
  return invokePersistence<void>('save_time_entries', { entries });
}

async function saveAutoStopTransition(
  timeEntries: TimeEntry[],
  completions: Completion[],
): Promise<void> {
  return invokePersistence<void>('save_auto_stop_transition', {
    request: { timeEntries, completions },
  });
}

async function saveTaskDailyMemo(memo: TaskDailyMemo): Promise<void> {
  return invokePersistence<void>('save_task_daily_memo', { memo });
}

async function getSetting<T>(key: string): Promise<T | null> {
  return invokePersistence<T | null>('get_setting', { key });
}

async function setSetting(key: string, value: unknown): Promise<void> {
  return invokePersistence<void>('set_setting', {
    request: { key, value },
  });
}

async function getMigrationMarker(key: string): Promise<string | null> {
  return invokePersistence<string | null>('get_migration_marker', { key });
}

async function setMigrationMarker(key: string, value: string): Promise<void> {
  return invokePersistence<void>('set_migration_marker', {
    request: { key, value },
  });
}

export const appDb = {
  init,
  load,
  importLegacy,
  saveTask,
  setTaskActive,
  deleteTask,
  setCompletion,
  saveTimeEntries,
  saveAutoStopTransition,
  saveTaskDailyMemo,
  getSetting,
  setSetting,
  getMigrationMarker,
  setMigrationMarker,
};
