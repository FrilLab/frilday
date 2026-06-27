import {
  CompletionsSchema,
  TaskDailyMemosSchema,
  TasksSchema,
  TimeEntriesSchema,
  type DayOfWeek,
} from '../../shared/schemas';
import type {
  Completion,
  Task,
  TaskDailyMemo,
  TimeEntry,
} from '../../shared/types';
import { appDb } from '../tauri/db';
import { isTauri } from '../tauri/runtime';

const STORAGE_KEYS = {
  tasks: 'dailycheck.tasks.v2',
  completions: 'dailycheck.completions.v1',
  timeEntries: 'dailycheck.timeEntries.v1',
  taskDailyMemos: 'dailycheck.taskDailyMemos.v1',
} as const;

const LEGACY_STORAGE_MIGRATION_KEY = 'legacy_storage_migrated_v1';

type PersistedAppData = {
  tasks: Task[];
  completions: Completion[];
  timeEntries: TimeEntry[];
  taskDailyMemos: TaskDailyMemo[];
};

type MetaRow = {
  value: string;
};

type TaskRow = {
  id: string;
  title: string;
  description: string;
  category: Task['category'];
  days_of_week: string;
  duration_minutes: number;
  start_ymd: string | null;
  auto_archive_after: number | null;
  repeat_count: number | null;
  is_active: number;
  created_at: string;
};

type CompletionRow = {
  task_id: string;
  date: string;
};

type TimeEntryRow = {
  id: string;
  task_id: string;
  date: string;
  started_at: string;
  ended_at: string | null;
  minutes: number;
};

type TaskDailyMemoRow = {
  id: string;
  task_id: string;
  date: string;
  text: string;
  updated_at: string;
};

function parseLegacyJson<T>(
  key: string,
  parse: (value: unknown) => T,
  fallback: T,
): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return parse(JSON.parse(raw) as unknown);
  } catch {
    return fallback;
  }
}

function parseLegacyDaysOfWeek(value: string): DayOfWeek[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    const result = TasksSchema.element.shape.daysOfWeek.safeParse(parsed);
    return result.success ? [...result.data] : [];
  } catch {
    return [];
  }
}

function taskFromRow(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    daysOfWeek: parseLegacyDaysOfWeek(row.days_of_week),
    durationMinutes: Number(row.duration_minutes),
    startYmd: row.start_ymd,
    autoArchiveAfter:
      row.auto_archive_after == null ? null : Number(row.auto_archive_after),
    repeatCount: row.repeat_count == null ? null : Number(row.repeat_count),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
  };
}

function completionFromRow(row: CompletionRow): Completion {
  return {
    taskId: row.task_id,
    date: row.date,
  };
}

function timeEntryFromRow(row: TimeEntryRow): TimeEntry {
  return {
    id: row.id,
    taskId: row.task_id,
    date: row.date,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    minutes: Number(row.minutes),
  };
}

function memoFromRow(row: TaskDailyMemoRow): TaskDailyMemo {
  return {
    id: row.id,
    taskId: row.task_id,
    date: row.date,
    text: row.text,
    updatedAt: row.updated_at,
  };
}

async function getMeta(key: string): Promise<string | null> {
  const rows = await appDb.select<MetaRow>(
    'SELECT value FROM app_meta WHERE key = ? LIMIT 1',
    [key],
  );
  return rows[0]?.value ?? null;
}

async function setMeta(key: string, value: string): Promise<void> {
  await appDb.execute(
    `
      INSERT INTO app_meta (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `,
    [key, value],
  );
}

async function hasExistingData(): Promise<boolean> {
  const [tasks, completions, timeEntries, memos] = await Promise.all([
    appDb.select<{ count: number }>('SELECT COUNT(*) AS count FROM tasks'),
    appDb.select<{ count: number }>(
      'SELECT COUNT(*) AS count FROM completions',
    ),
    appDb.select<{ count: number }>(
      'SELECT COUNT(*) AS count FROM time_entries',
    ),
    appDb.select<{ count: number }>(
      'SELECT COUNT(*) AS count FROM task_daily_memos',
    ),
  ]);

  return [tasks, completions, timeEntries, memos].some(
    (rows) => Number(rows[0]?.count ?? 0) > 0,
  );
}

async function replaceTasks(tasks: Task[]): Promise<void> {
  await appDb.execute('DELETE FROM tasks');

  for (const task of tasks) {
    await appDb.execute(
      `
        INSERT INTO tasks (
          id,
          title,
          description,
          category,
          days_of_week,
          duration_minutes,
          start_ymd,
          auto_archive_after,
          repeat_count,
          is_active,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        task.id,
        task.title,
        task.description,
        task.category,
        JSON.stringify(task.daysOfWeek),
        task.durationMinutes,
        task.startYmd ?? null,
        task.autoArchiveAfter ?? null,
        task.repeatCount ?? null,
        task.isActive ? 1 : 0,
        task.createdAt,
      ],
    );
  }
}

async function replaceCompletions(completions: Completion[]): Promise<void> {
  await appDb.execute('DELETE FROM completions');

  for (const completion of completions) {
    await appDb.execute(
      'INSERT INTO completions (task_id, date) VALUES (?, ?)',
      [completion.taskId, completion.date],
    );
  }
}

async function replaceTimeEntries(timeEntries: TimeEntry[]): Promise<void> {
  await appDb.execute('DELETE FROM time_entries');

  for (const entry of timeEntries) {
    await appDb.execute(
      `
        INSERT INTO time_entries (
          id,
          task_id,
          date,
          started_at,
          ended_at,
          minutes
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        entry.id,
        entry.taskId,
        entry.date,
        entry.startedAt,
        entry.endedAt,
        entry.minutes,
      ],
    );
  }
}

async function replaceTaskDailyMemos(
  taskDailyMemos: TaskDailyMemo[],
): Promise<void> {
  await appDb.execute('DELETE FROM task_daily_memos');

  for (const memo of taskDailyMemos) {
    await appDb.execute(
      `
        INSERT INTO task_daily_memos (
          id,
          task_id,
          date,
          text,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?)
      `,
      [memo.id, memo.taskId, memo.date, memo.text, memo.updatedAt],
    );
  }
}

async function saveAppData(data: PersistedAppData): Promise<void> {
  if (!isTauri()) return;

  await appDb.init();
  await replaceTasks(data.tasks);
  await replaceCompletions(data.completions);
  await replaceTimeEntries(data.timeEntries);
  await replaceTaskDailyMemos(data.taskDailyMemos);
}

function loadLegacyAppData(): PersistedAppData {
  return {
    tasks: parseLegacyJson(
      STORAGE_KEYS.tasks,
      (decoded) => {
        const result = TasksSchema.safeParse(decoded);
        return result.success ? (result.data as Task[]) : [];
      },
      [],
    ),
    completions: parseLegacyJson(
      STORAGE_KEYS.completions,
      (decoded) => {
        const result = CompletionsSchema.safeParse(decoded);
        return result.success ? (result.data as Completion[]) : [];
      },
      [],
    ),
    timeEntries: parseLegacyJson(
      STORAGE_KEYS.timeEntries,
      (decoded) => {
        const result = TimeEntriesSchema.safeParse(decoded);
        return result.success ? (result.data as TimeEntry[]) : [];
      },
      [],
    ),
    taskDailyMemos: parseLegacyJson(
      STORAGE_KEYS.taskDailyMemos,
      (decoded) => {
        const result = TaskDailyMemosSchema.safeParse(decoded);
        return result.success ? (result.data as TaskDailyMemo[]) : [];
      },
      [],
    ),
  };
}

function clearLegacyAppData(): void {
  for (const key of Object.values(STORAGE_KEYS)) {
    localStorage.removeItem(key);
  }
}

async function migrateLegacyStorageIfNeeded(): Promise<void> {
  if (!isTauri()) return;

  await appDb.init();

  const alreadyMigrated = await getMeta(LEGACY_STORAGE_MIGRATION_KEY);
  if (alreadyMigrated === '1') {
    return;
  }

  if (await hasExistingData()) {
    await setMeta(LEGACY_STORAGE_MIGRATION_KEY, '1');
    clearLegacyAppData();
    return;
  }

  const legacyData = loadLegacyAppData();
  const hasLegacyData =
    legacyData.tasks.length > 0 ||
    legacyData.completions.length > 0 ||
    legacyData.timeEntries.length > 0 ||
    legacyData.taskDailyMemos.length > 0;

  if (hasLegacyData) {
    await saveAppData(legacyData);
  }

  clearLegacyAppData();
  await setMeta(LEGACY_STORAGE_MIGRATION_KEY, '1');
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

  await migrateLegacyStorageIfNeeded();

  const [taskRows, completionRows, timeEntryRows, memoRows] = await Promise.all(
    [
      appDb.select<TaskRow>(
        `
        SELECT
          id,
          title,
          description,
          category,
          days_of_week,
          duration_minutes,
          start_ymd,
          auto_archive_after,
          repeat_count,
          is_active,
          created_at
        FROM tasks
        ORDER BY created_at DESC
      `,
      ),
      appDb.select<CompletionRow>(
        'SELECT task_id, date FROM completions ORDER BY date DESC, task_id ASC',
      ),
      appDb.select<TimeEntryRow>(
        `
        SELECT
          id,
          task_id,
          date,
          started_at,
          ended_at,
          minutes
        FROM time_entries
        ORDER BY started_at DESC
      `,
      ),
      appDb.select<TaskDailyMemoRow>(
        `
        SELECT
          id,
          task_id,
          date,
          text,
          updated_at
        FROM task_daily_memos
        ORDER BY updated_at DESC
      `,
      ),
    ],
  );

  return {
    tasks: TasksSchema.parse(taskRows.map(taskFromRow)) as Task[],
    completions: CompletionsSchema.parse(
      completionRows.map(completionFromRow),
    ) as Completion[],
    timeEntries: TimeEntriesSchema.parse(
      timeEntryRows.map(timeEntryFromRow),
    ) as TimeEntry[],
    taskDailyMemos: TaskDailyMemosSchema.parse(
      memoRows.map(memoFromRow),
    ) as TaskDailyMemo[],
  };
}

export async function saveTasks(tasks: Task[]): Promise<void> {
  await saveAppData({
    tasks,
    completions: await loadCompletions(),
    timeEntries: await loadTimeEntries(),
    taskDailyMemos: await loadTaskDailyMemos(),
  });
}

export async function saveCompletions(
  completions: Completion[],
): Promise<void> {
  await saveAppData({
    tasks: await loadTasks(),
    completions,
    timeEntries: await loadTimeEntries(),
    taskDailyMemos: await loadTaskDailyMemos(),
  });
}

export async function saveTimeEntries(timeEntries: TimeEntry[]): Promise<void> {
  await saveAppData({
    tasks: await loadTasks(),
    completions: await loadCompletions(),
    timeEntries,
    taskDailyMemos: await loadTaskDailyMemos(),
  });
}

export async function saveTaskDailyMemos(
  taskDailyMemos: TaskDailyMemo[],
): Promise<void> {
  await saveAppData({
    tasks: await loadTasks(),
    completions: await loadCompletions(),
    timeEntries: await loadTimeEntries(),
    taskDailyMemos,
  });
}

export async function replaceAllAppData(data: PersistedAppData): Promise<void> {
  await migrateLegacyStorageIfNeeded();
  await saveAppData(data);
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
