import { appDb } from './db';
import { isTauri } from './runtime';

const SETTINGS_FILE = 'settings.json';
const LEGACY_SETTINGS_MIGRATION_KEY = 'legacy_settings_migrated_v1';
const LEGACY_SETTING_KEYS = ['locale', 'settings.notifications.timerDone'] as const;

type SqlValueRow = {
  value: string;
};

type MetaRow = {
  value: string;
};

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

async function readSqlSetting<T>(key: string): Promise<T | null> {
  const rows = await appDb.select<SqlValueRow>(
    'SELECT value FROM settings_kv WHERE key = ? LIMIT 1',
    [key],
  );

  if (!rows[0]) return null;

  try {
    return JSON.parse(rows[0].value) as T;
  } catch {
    return null;
  }
}

async function writeSqlSetting(key: string, value: unknown): Promise<void> {
  await appDb.execute(
    `
      INSERT INTO settings_kv (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `,
    [key, JSON.stringify(value)],
  );
}

function readLegacyStorageSetting<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function migrateLegacySettingsIfNeeded(): Promise<void> {
  if (!isTauri()) return;

  await appDb.init();

  const alreadyMigrated = await getMeta(LEGACY_SETTINGS_MIGRATION_KEY);
  if (alreadyMigrated === '1') {
    return;
  }

  let legacyStoreValues = new Map<string, unknown>();

  try {
    const { load } = await import('@tauri-apps/plugin-store');
    const store = await load(SETTINGS_FILE, { autoSave: 150, defaults: {} });

    for (const key of LEGACY_SETTING_KEYS) {
      const value = await store.get<unknown>(key);
      if (value != null) {
        legacyStoreValues.set(key, value);
      }
    }
  } catch {
    legacyStoreValues = new Map<string, unknown>();
  }

  for (const key of LEGACY_SETTING_KEYS) {
    const existing = await readSqlSetting(key);
    if (existing != null) continue;

    const legacyValue =
      legacyStoreValues.get(key) ?? readLegacyStorageSetting<unknown>(key);

    if (legacyValue != null) {
      await writeSqlSetting(key, legacyValue);
    }

    localStorage.removeItem(key);
  }

  await setMeta(LEGACY_SETTINGS_MIGRATION_KEY, '1');
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  if (!isTauri()) {
    return fallback;
  }

  try {
    await migrateLegacySettingsIfNeeded();
    const value = await readSqlSetting<T>(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  if (!isTauri()) {
    return;
  }

  await migrateLegacySettingsIfNeeded();
  await writeSqlSetting(key, value);
}
