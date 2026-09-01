import { appDb } from './db';
import { isTauri } from './runtime';

const SETTINGS_FILE = 'settings.json';
const LEGACY_SETTINGS_MIGRATION_KEY = 'legacy_settings_migrated_v1';
const LEGACY_SETTING_KEYS = ['locale', 'settings.notifications.timerDone'] as const;

async function readSqlSetting<T>(key: string): Promise<T | null> {
  return appDb.getSetting<T>(key);
}

async function writeSqlSetting(key: string, value: unknown): Promise<void> {
  await appDb.setSetting(key, value);
}

type LegacySetting = {
  value: unknown;
  present: boolean;
  valid: boolean;
};

function readLegacyStorageSetting(key: string): LegacySetting {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return { value: null, present: false, valid: true };
    return { value: JSON.parse(raw) as unknown, present: true, valid: true };
  } catch {
    return { value: null, present: true, valid: false };
  }
}

async function migrateLegacySettingsIfNeeded(): Promise<void> {
  if (!isTauri()) return;

  const alreadyMigrated = await appDb.getMigrationMarker(
    LEGACY_SETTINGS_MIGRATION_KEY,
  );
  if (alreadyMigrated === '1') return;

  let legacyStoreValues = new Map<string, unknown>();
  let hasInvalidLegacyValue = false;

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
    const legacyLocalValue = readLegacyStorageSetting(key);
    if (!legacyLocalValue.valid) {
      hasInvalidLegacyValue = true;
      continue;
    }

    const existing = await readSqlSetting(key);

    const legacyValue =
      legacyStoreValues.get(key) ?? legacyLocalValue.value;

    if (existing == null && legacyValue != null) {
      await writeSqlSetting(key, legacyValue);
    }

    if (legacyLocalValue.present) {
      localStorage.removeItem(key);
    }
  }

  if (!hasInvalidLegacyValue) {
    await appDb.setMigrationMarker(LEGACY_SETTINGS_MIGRATION_KEY, '1');
  }
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
