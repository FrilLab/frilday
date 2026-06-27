import { isTauri } from './runtime';

export type AppDb = {
  init(): Promise<void>;
  execute(sql: string, bind?: unknown[]): Promise<void>;
  select<T>(sql: string, bind?: unknown[]): Promise<T[]>;
};

const DB_URL = 'sqlite:daily_check.db';

let dbPromise: Promise<import('@tauri-apps/plugin-sql').default> | null = null;

async function getDatabase(): Promise<import('@tauri-apps/plugin-sql').default> {
  if (!isTauri()) {
    throw new Error('SQLite is unavailable in web runtime.');
  }

  if (!dbPromise) {
    dbPromise = import('@tauri-apps/plugin-sql').then(({ default: Database }) =>
      Database.load(DB_URL),
    );
  }

  return dbPromise;
}

async function init(): Promise<void> {
  if (!isTauri()) return;

  const db = await getDatabase();
  await db.execute(
    `
      CREATE TABLE IF NOT EXISTS settings_kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `,
    [],
  );
  await db.execute(
    `
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `,
    [],
  );
  await db.execute(
    `
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        days_of_week TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL,
        start_ymd TEXT,
        auto_archive_after INTEGER,
        repeat_count INTEGER,
        is_active INTEGER NOT NULL,
        created_at TEXT NOT NULL
      )
    `,
    [],
  );
  await db.execute(
    `
      CREATE TABLE IF NOT EXISTS completions (
        task_id TEXT NOT NULL,
        date TEXT NOT NULL,
        PRIMARY KEY (task_id, date)
      )
    `,
    [],
  );
  await db.execute(
    `
      CREATE TABLE IF NOT EXISTS time_entries (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        date TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        minutes INTEGER NOT NULL
      )
    `,
    [],
  );
  await db.execute(
    `
      CREATE TABLE IF NOT EXISTS task_daily_memos (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        date TEXT NOT NULL,
        text TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (task_id, date)
      )
    `,
    [],
  );
}

async function execute(sql: string, bind: unknown[] = []): Promise<void> {
  if (!isTauri()) return;
  const db = await getDatabase();
  await db.execute(sql, bind);
}

async function select<T>(sql: string, bind: unknown[] = []): Promise<T[]> {
  if (!isTauri()) {
    return [];
  }
  const db = await getDatabase();
  return db.select<T[]>(sql, bind);
}

export const appDb: AppDb = {
  init,
  execute,
  select,
};
