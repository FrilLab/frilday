use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{FromRow, Sqlite, SqlitePool, Transaction};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

pub const DB_URL: &str = "sqlite:daily_check.db";
const LEGACY_STORAGE_MIGRATION_KEY: &str = "legacy_storage_migrated_v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskRecord {
    pub id: String,
    pub title: String,
    pub description: String,
    pub category: String,
    pub days_of_week: Vec<String>,
    pub duration_minutes: u32,
    pub start_ymd: Option<String>,
    pub auto_archive_after: Option<u32>,
    pub repeat_count: Option<u32>,
    pub is_active: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompletionRecord {
    pub task_id: String,
    pub date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimeEntryRecord {
    pub id: String,
    pub task_id: String,
    pub date: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub minutes: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskDailyMemoRecord {
    pub id: String,
    pub task_id: String,
    pub date: String,
    pub text: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppData {
    pub tasks: Vec<TaskRecord>,
    pub completions: Vec<CompletionRecord>,
    pub time_entries: Vec<TimeEntryRecord>,
    pub task_daily_memos: Vec<TaskDailyMemoRecord>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyMigrationOutput {
    pub imported: bool,
    pub skipped_existing_data: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskActiveRequest {
    pub task_id: String,
    pub is_active: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionStateRequest {
    pub task_id: String,
    pub date: String,
    pub completed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoStopTransitionRequest {
    pub time_entries: Vec<TimeEntryRecord>,
    pub completions: Vec<CompletionRecord>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingRequest {
    pub key: String,
    pub value: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataRequest {
    pub key: String,
    pub value: String,
}

#[derive(Debug, FromRow)]
struct TaskRow {
    id: String,
    title: String,
    description: String,
    category: String,
    days_of_week: String,
    duration_minutes: i64,
    start_ymd: Option<String>,
    auto_archive_after: Option<i64>,
    repeat_count: Option<i64>,
    is_active: i64,
    created_at: String,
}

#[derive(Debug, FromRow)]
struct CompletionRow {
    task_id: String,
    date: String,
}

#[derive(Debug, FromRow)]
struct TimeEntryRow {
    id: String,
    task_id: String,
    date: String,
    started_at: String,
    ended_at: Option<String>,
    minutes: i64,
}

#[derive(Debug, FromRow)]
struct TaskDailyMemoRow {
    id: String,
    task_id: String,
    date: String,
    text: String,
    updated_at: String,
}

#[derive(Debug, FromRow)]
struct MetaRow {
    value: String,
}

#[derive(Debug, FromRow)]
struct SettingRow {
    value: String,
}

async fn database_pool(db_instances: &DbInstances) -> Result<SqlitePool, String> {
    let instances = db_instances.0.read().await;
    match instances.get(DB_URL) {
        Some(DbPool::Sqlite(pool)) => Ok(pool.clone()),
        None => Err(format!("Database is not loaded: {DB_URL}")),
    }
}

pub async fn initialize_schema(pool: &SqlitePool) -> Result<(), String> {
    let statements = [
        "CREATE TABLE IF NOT EXISTS settings_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        "CREATE TABLE IF NOT EXISTS tasks (
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
        )",
        "CREATE TABLE IF NOT EXISTS completions (
            task_id TEXT NOT NULL,
            date TEXT NOT NULL,
            PRIMARY KEY (task_id, date)
        )",
        "CREATE TABLE IF NOT EXISTS time_entries (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            date TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            minutes INTEGER NOT NULL
        )",
        "CREATE TABLE IF NOT EXISTS task_daily_memos (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            date TEXT NOT NULL,
            text TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (task_id, date)
        )",
    ];

    for statement in statements {
        sqlx::query(statement)
            .execute(pool)
            .await
            .map_err(|error| format!("Failed to initialize app database: {error}"))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn initialize_app_database(db_instances: State<'_, DbInstances>) -> Result<(), String> {
    let pool = database_pool(&db_instances).await?;
    initialize_schema(&pool).await
}

pub async fn load_app_data_from_pool(pool: &SqlitePool) -> Result<AppData, String> {
    let task_rows = sqlx::query_as::<_, TaskRow>(
        "SELECT id, title, description, category, days_of_week, duration_minutes,
                start_ymd, auto_archive_after, repeat_count, is_active, created_at
         FROM tasks ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Failed to load tasks: {error}"))?;

    let completion_rows = sqlx::query_as::<_, CompletionRow>(
        "SELECT task_id, date FROM completions ORDER BY date DESC, task_id ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Failed to load completions: {error}"))?;

    let time_entry_rows = sqlx::query_as::<_, TimeEntryRow>(
        "SELECT id, task_id, date, started_at, ended_at, minutes
         FROM time_entries ORDER BY started_at DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Failed to load time entries: {error}"))?;

    let memo_rows = sqlx::query_as::<_, TaskDailyMemoRow>(
        "SELECT id, task_id, date, text, updated_at
         FROM task_daily_memos ORDER BY updated_at DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Failed to load daily memos: {error}"))?;

    let tasks = task_rows
        .into_iter()
        .map(task_from_row)
        .collect::<Result<Vec<_>, _>>()?;
    let time_entries = time_entry_rows
        .into_iter()
        .map(time_entry_from_row)
        .collect::<Result<Vec<_>, _>>()?;

    Ok(AppData {
        tasks,
        completions: completion_rows
            .into_iter()
            .map(|row| CompletionRecord {
                task_id: row.task_id,
                date: row.date,
            })
            .collect(),
        time_entries,
        task_daily_memos: memo_rows
            .into_iter()
            .map(|row| TaskDailyMemoRecord {
                id: row.id,
                task_id: row.task_id,
                date: row.date,
                text: row.text,
                updated_at: row.updated_at,
            })
            .collect(),
    })
}

fn task_from_row(row: TaskRow) -> Result<TaskRecord, String> {
    let days_of_week = serde_json::from_str(&row.days_of_week)
        .map_err(|error| format!("Failed to decode task schedule: {error}"))?;
    Ok(TaskRecord {
        id: row.id,
        title: row.title,
        description: row.description,
        category: row.category,
        days_of_week,
        duration_minutes: u32::try_from(row.duration_minutes)
            .map_err(|_| "Task duration is outside the supported range".to_owned())?,
        start_ymd: row.start_ymd,
        auto_archive_after: row
            .auto_archive_after
            .map(u32::try_from)
            .transpose()
            .map_err(|_| "Task archive threshold is invalid".to_owned())?,
        repeat_count: row
            .repeat_count
            .map(u32::try_from)
            .transpose()
            .map_err(|_| "Task repeat count is invalid".to_owned())?,
        is_active: row.is_active != 0,
        created_at: row.created_at,
    })
}

fn time_entry_from_row(row: TimeEntryRow) -> Result<TimeEntryRecord, String> {
    Ok(TimeEntryRecord {
        id: row.id,
        task_id: row.task_id,
        date: row.date,
        started_at: row.started_at,
        ended_at: row.ended_at,
        minutes: u32::try_from(row.minutes)
            .map_err(|_| "Time entry duration is outside the supported range".to_owned())?,
    })
}

#[tauri::command]
pub async fn load_app_data(db_instances: State<'_, DbInstances>) -> Result<AppData, String> {
    let pool = database_pool(&db_instances).await?;
    initialize_schema(&pool).await?;
    load_app_data_from_pool(&pool).await
}

async fn set_meta(
    executor: &mut Transaction<'_, Sqlite>,
    key: &str,
    value: &str,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO app_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key)
    .bind(value)
    .execute(&mut **executor)
    .await
    .map(|_| ())
    .map_err(|error| format!("Failed to save app metadata: {error}"))
}

async fn migration_marker(pool: &SqlitePool) -> Result<Option<String>, String> {
    migration_marker_for_key(pool, LEGACY_STORAGE_MIGRATION_KEY).await
}

#[tauri::command]
pub async fn get_migration_marker(
    db_instances: State<'_, DbInstances>,
    key: String,
) -> Result<Option<String>, String> {
    let pool = database_pool(&db_instances).await?;
    migration_marker_for_key(&pool, &key).await
}

async fn migration_marker_for_key(pool: &SqlitePool, key: &str) -> Result<Option<String>, String> {
    sqlx::query_as::<_, MetaRow>("SELECT value FROM app_meta WHERE key = ? LIMIT 1")
        .bind(key)
        .fetch_optional(pool)
        .await
        .map(|row| row.map(|row| row.value))
        .map_err(|error| format!("Failed to read app metadata: {error}"))
}

#[tauri::command]
pub async fn set_migration_marker(
    db_instances: State<'_, DbInstances>,
    request: MetadataRequest,
) -> Result<(), String> {
    let pool = database_pool(&db_instances).await?;
    sqlx::query(
        "INSERT INTO app_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(request.key)
    .bind(request.value)
    .execute(&pool)
    .await
    .map(|_| ())
    .map_err(|error| format!("Failed to save app metadata: {error}"))
}

async fn has_existing_data(pool: &SqlitePool) -> Result<bool, String> {
    let tables = ["tasks", "completions", "time_entries", "task_daily_memos"];
    for table in tables {
        let query = format!("SELECT EXISTS(SELECT 1 FROM {table} LIMIT 1)");
        let has_rows: i64 = sqlx::query_scalar(&query)
            .fetch_one(pool)
            .await
            .map_err(|error| format!("Failed to inspect existing app data: {error}"))?;
        if has_rows != 0 {
            return Ok(true);
        }
    }
    Ok(false)
}

async fn insert_task(
    executor: &mut Transaction<'_, Sqlite>,
    task: &TaskRecord,
) -> Result<(), String> {
    let days_of_week = serde_json::to_string(&task.days_of_week)
        .map_err(|error| format!("Failed to encode task schedule: {error}"))?;
    sqlx::query(
        "INSERT INTO tasks (
            id, title, description, category, days_of_week, duration_minutes,
            start_ymd, auto_archive_after, repeat_count, is_active, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            description = excluded.description,
            category = excluded.category,
            days_of_week = excluded.days_of_week,
            duration_minutes = excluded.duration_minutes,
            start_ymd = excluded.start_ymd,
            auto_archive_after = excluded.auto_archive_after,
            repeat_count = excluded.repeat_count,
            is_active = excluded.is_active,
            created_at = excluded.created_at",
    )
    .bind(&task.id)
    .bind(&task.title)
    .bind(&task.description)
    .bind(&task.category)
    .bind(days_of_week)
    .bind(i64::from(task.duration_minutes))
    .bind(&task.start_ymd)
    .bind(task.auto_archive_after.map(i64::from))
    .bind(task.repeat_count.map(i64::from))
    .bind(if task.is_active { 1_i64 } else { 0_i64 })
    .bind(&task.created_at)
    .execute(&mut **executor)
    .await
    .map(|_| ())
    .map_err(|error| format!("Failed to save task: {error}"))
}

async fn insert_task_if_absent(
    executor: &mut Transaction<'_, Sqlite>,
    task: &TaskRecord,
) -> Result<(), String> {
    let days_of_week = serde_json::to_string(&task.days_of_week)
        .map_err(|error| format!("Failed to encode task schedule: {error}"))?;
    sqlx::query(
        "INSERT INTO tasks (
            id, title, description, category, days_of_week, duration_minutes,
            start_ymd, auto_archive_after, repeat_count, is_active, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING",
    )
    .bind(&task.id)
    .bind(&task.title)
    .bind(&task.description)
    .bind(&task.category)
    .bind(days_of_week)
    .bind(i64::from(task.duration_minutes))
    .bind(&task.start_ymd)
    .bind(task.auto_archive_after.map(i64::from))
    .bind(task.repeat_count.map(i64::from))
    .bind(if task.is_active { 1_i64 } else { 0_i64 })
    .bind(&task.created_at)
    .execute(&mut **executor)
    .await
    .map(|_| ())
    .map_err(|error| format!("Failed to import task: {error}"))
}

async fn insert_completion(
    executor: &mut Transaction<'_, Sqlite>,
    completion: &CompletionRecord,
) -> Result<(), String> {
    sqlx::query("INSERT INTO completions (task_id, date) VALUES (?, ?) ON CONFLICT DO NOTHING")
        .bind(&completion.task_id)
        .bind(&completion.date)
        .execute(&mut **executor)
        .await
        .map(|_| ())
        .map_err(|error| format!("Failed to save completion: {error}"))
}

async fn insert_time_entry(
    executor: &mut Transaction<'_, Sqlite>,
    entry: &TimeEntryRecord,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO time_entries (id, task_id, date, started_at, ended_at, minutes)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            task_id = excluded.task_id,
            date = excluded.date,
            started_at = excluded.started_at,
            ended_at = excluded.ended_at,
            minutes = excluded.minutes",
    )
    .bind(&entry.id)
    .bind(&entry.task_id)
    .bind(&entry.date)
    .bind(&entry.started_at)
    .bind(&entry.ended_at)
    .bind(i64::from(entry.minutes))
    .execute(&mut **executor)
    .await
    .map(|_| ())
    .map_err(|error| format!("Failed to save time entry: {error}"))
}

async fn insert_time_entry_if_absent(
    executor: &mut Transaction<'_, Sqlite>,
    entry: &TimeEntryRecord,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO time_entries (id, task_id, date, started_at, ended_at, minutes)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING",
    )
    .bind(&entry.id)
    .bind(&entry.task_id)
    .bind(&entry.date)
    .bind(&entry.started_at)
    .bind(&entry.ended_at)
    .bind(i64::from(entry.minutes))
    .execute(&mut **executor)
    .await
    .map(|_| ())
    .map_err(|error| format!("Failed to import time entry: {error}"))
}

async fn insert_memo(
    executor: &mut Transaction<'_, Sqlite>,
    memo: &TaskDailyMemoRecord,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO task_daily_memos (id, task_id, date, text, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(task_id, date) DO UPDATE SET
            id = excluded.id,
            text = excluded.text,
            updated_at = excluded.updated_at",
    )
    .bind(&memo.id)
    .bind(&memo.task_id)
    .bind(&memo.date)
    .bind(&memo.text)
    .bind(&memo.updated_at)
    .execute(&mut **executor)
    .await
    .map(|_| ())
    .map_err(|error| format!("Failed to save daily memo: {error}"))
}

async fn insert_memo_if_absent(
    executor: &mut Transaction<'_, Sqlite>,
    memo: &TaskDailyMemoRecord,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO task_daily_memos (id, task_id, date, text, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(task_id, date) DO NOTHING",
    )
    .bind(&memo.id)
    .bind(&memo.task_id)
    .bind(&memo.date)
    .bind(&memo.text)
    .bind(&memo.updated_at)
    .execute(&mut **executor)
    .await
    .map(|_| ())
    .map_err(|error| format!("Failed to import daily memo: {error}"))
}

async fn import_app_data(
    pool: &SqlitePool,
    data: &AppData,
) -> Result<LegacyMigrationOutput, String> {
    if migration_marker(pool).await?.as_deref() == Some("1") {
        return Ok(LegacyMigrationOutput {
            imported: false,
            skipped_existing_data: false,
        });
    }

    let skipped_existing_data = has_existing_data(pool).await?;

    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("Failed to begin migration transaction: {error}"))?;

    for task in &data.tasks {
        insert_task_if_absent(&mut transaction, task).await?;
    }
    for completion in &data.completions {
        insert_completion(&mut transaction, completion).await?;
    }
    for entry in &data.time_entries {
        insert_time_entry_if_absent(&mut transaction, entry).await?;
    }
    for memo in &data.task_daily_memos {
        insert_memo_if_absent(&mut transaction, memo).await?;
    }
    set_meta(&mut transaction, LEGACY_STORAGE_MIGRATION_KEY, "1").await?;
    transaction
        .commit()
        .await
        .map_err(|error| format!("Failed to commit data migration: {error}"))?;

    Ok(LegacyMigrationOutput {
        imported: !data.tasks.is_empty()
            || !data.completions.is_empty()
            || !data.time_entries.is_empty()
            || !data.task_daily_memos.is_empty(),
        skipped_existing_data,
    })
}

#[tauri::command]
pub async fn import_legacy_app_data(
    db_instances: State<'_, DbInstances>,
    data: AppData,
) -> Result<LegacyMigrationOutput, String> {
    let pool = database_pool(&db_instances).await?;
    initialize_schema(&pool).await?;
    import_app_data(&pool, &data).await
}

#[tauri::command]
pub async fn save_task(
    db_instances: State<'_, DbInstances>,
    task: TaskRecord,
) -> Result<(), String> {
    let pool = database_pool(&db_instances).await?;
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("Failed to begin app data transaction: {error}"))?;
    insert_task(&mut transaction, &task).await?;
    transaction
        .commit()
        .await
        .map_err(|error| format!("Failed to commit app data transaction: {error}"))
}

#[tauri::command]
pub async fn set_task_active(
    db_instances: State<'_, DbInstances>,
    request: TaskActiveRequest,
) -> Result<(), String> {
    let pool = database_pool(&db_instances).await?;
    sqlx::query("UPDATE tasks SET is_active = ? WHERE id = ?")
        .bind(if request.is_active { 1_i64 } else { 0_i64 })
        .bind(request.task_id)
        .execute(&pool)
        .await
        .map(|_| ())
        .map_err(|error| format!("Failed to update task state: {error}"))
}

#[tauri::command]
pub async fn delete_task(
    db_instances: State<'_, DbInstances>,
    task_id: String,
) -> Result<(), String> {
    let pool = database_pool(&db_instances).await?;
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("Failed to begin app data transaction: {error}"))?;
    for table in ["completions", "time_entries", "task_daily_memos"] {
        let query = format!("DELETE FROM {table} WHERE task_id = ?");
        sqlx::query(&query)
            .bind(&task_id)
            .execute(&mut *transaction)
            .await
            .map_err(|error| format!("Failed to delete task data: {error}"))?;
    }
    sqlx::query("DELETE FROM tasks WHERE id = ?")
        .bind(task_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("Failed to delete task: {error}"))?;
    transaction
        .commit()
        .await
        .map_err(|error| format!("Failed to commit app data transaction: {error}"))
}

#[tauri::command]
pub async fn set_completion(
    db_instances: State<'_, DbInstances>,
    request: CompletionStateRequest,
) -> Result<(), String> {
    let pool = database_pool(&db_instances).await?;
    if request.completed {
        sqlx::query("INSERT INTO completions (task_id, date) VALUES (?, ?) ON CONFLICT DO NOTHING")
            .bind(request.task_id)
            .bind(request.date)
            .execute(&pool)
            .await
            .map(|_| ())
            .map_err(|error| format!("Failed to save completion: {error}"))
    } else {
        sqlx::query("DELETE FROM completions WHERE task_id = ? AND date = ?")
            .bind(request.task_id)
            .bind(request.date)
            .execute(&pool)
            .await
            .map(|_| ())
            .map_err(|error| format!("Failed to remove completion: {error}"))
    }
}

#[tauri::command]
pub async fn save_time_entries(
    db_instances: State<'_, DbInstances>,
    entries: Vec<TimeEntryRecord>,
) -> Result<(), String> {
    let pool = database_pool(&db_instances).await?;
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("Failed to begin app data transaction: {error}"))?;
    for entry in &entries {
        insert_time_entry(&mut transaction, entry).await?;
    }
    transaction
        .commit()
        .await
        .map_err(|error| format!("Failed to commit app data transaction: {error}"))
}

async fn save_auto_stop_transition_to_pool(
    pool: &SqlitePool,
    request: &AutoStopTransitionRequest,
) -> Result<(), String> {
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("Failed to begin app data transaction: {error}"))?;
    for entry in &request.time_entries {
        insert_time_entry(&mut transaction, entry).await?;
    }
    for completion in &request.completions {
        insert_completion(&mut transaction, completion).await?;
    }
    transaction
        .commit()
        .await
        .map_err(|error| format!("Failed to commit app data transaction: {error}"))
}

#[tauri::command]
pub async fn save_auto_stop_transition(
    db_instances: State<'_, DbInstances>,
    request: AutoStopTransitionRequest,
) -> Result<(), String> {
    let pool = database_pool(&db_instances).await?;
    save_auto_stop_transition_to_pool(&pool, &request).await
}

#[tauri::command]
pub async fn save_task_daily_memo(
    db_instances: State<'_, DbInstances>,
    memo: TaskDailyMemoRecord,
) -> Result<(), String> {
    let pool = database_pool(&db_instances).await?;
    if memo.text.trim().is_empty() {
        sqlx::query("DELETE FROM task_daily_memos WHERE task_id = ? AND date = ?")
            .bind(memo.task_id)
            .bind(memo.date)
            .execute(&pool)
            .await
            .map(|_| ())
            .map_err(|error| format!("Failed to remove daily memo: {error}"))
    } else {
        let mut transaction = pool
            .begin()
            .await
            .map_err(|error| format!("Failed to begin app data transaction: {error}"))?;
        insert_memo(&mut transaction, &memo).await?;
        transaction
            .commit()
            .await
            .map_err(|error| format!("Failed to commit app data transaction: {error}"))
    }
}

#[tauri::command]
pub async fn get_setting(
    db_instances: State<'_, DbInstances>,
    key: String,
) -> Result<Option<Value>, String> {
    let pool = database_pool(&db_instances).await?;
    let row =
        sqlx::query_as::<_, SettingRow>("SELECT value FROM settings_kv WHERE key = ? LIMIT 1")
            .bind(key)
            .fetch_optional(&pool)
            .await
            .map_err(|error| format!("Failed to load setting: {error}"))?;

    match row {
        Some(row) => Ok(serde_json::from_str(&row.value).ok()),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn set_setting(
    db_instances: State<'_, DbInstances>,
    request: SettingRequest,
) -> Result<(), String> {
    let pool = database_pool(&db_instances).await?;
    let value = serde_json::to_string(&request.value)
        .map_err(|error| format!("Failed to encode setting: {error}"))?;
    sqlx::query(
        "INSERT INTO settings_kv (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(request.key)
    .bind(value)
    .execute(&pool)
    .await
    .map(|_| ())
    .map_err(|error| format!("Failed to save setting: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    fn sample_data() -> AppData {
        AppData {
            tasks: vec![TaskRecord {
                id: "task-1".to_owned(),
                title: "Focus".to_owned(),
                description: "".to_owned(),
                category: "weekday".to_owned(),
                days_of_week: vec!["Mon".to_owned(), "Wed".to_owned()],
                duration_minutes: 30,
                start_ymd: None,
                auto_archive_after: None,
                repeat_count: None,
                is_active: true,
                created_at: "2026-01-01T00:00:00.000Z".to_owned(),
            }],
            completions: vec![CompletionRecord {
                task_id: "task-1".to_owned(),
                date: "2026-01-05".to_owned(),
            }],
            time_entries: vec![TimeEntryRecord {
                id: "entry-1".to_owned(),
                task_id: "task-1".to_owned(),
                date: "2026-01-05".to_owned(),
                started_at: "2026-01-05T09:00:00.000Z".to_owned(),
                ended_at: Some("2026-01-05T09:30:00.000Z".to_owned()),
                minutes: 30,
            }],
            task_daily_memos: vec![TaskDailyMemoRecord {
                id: "task-1_2026-01-05".to_owned(),
                task_id: "task-1".to_owned(),
                date: "2026-01-05".to_owned(),
                text: "Good focus".to_owned(),
                updated_at: "2026-01-05T09:30:00.000Z".to_owned(),
            }],
        }
    }

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        initialize_schema(&pool).await.unwrap();
        pool
    }

    #[test]
    fn imports_and_loads_all_desktop_records() {
        tauri::async_runtime::block_on(async {
            let pool = test_pool().await;
            let data = sample_data();

            let result = import_app_data(&pool, &data).await.unwrap();
            assert_eq!(result.imported, true);
            assert_eq!(load_app_data_from_pool(&pool).await.unwrap(), data);
        });
    }

    #[test]
    fn migration_is_idempotent_and_does_not_duplicate_records() {
        tauri::async_runtime::block_on(async {
            let pool = test_pool().await;
            let data = sample_data();

            import_app_data(&pool, &data).await.unwrap();
            let second = import_app_data(&pool, &data).await.unwrap();
            assert_eq!(second.imported, false);

            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tasks")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count, 1);
        });
    }

    #[test]
    fn existing_database_wins_over_legacy_import() {
        tauri::async_runtime::block_on(async {
            let pool = test_pool().await;
            let existing = TaskRecord {
                id: "existing".to_owned(),
                title: "Existing".to_owned(),
                description: "".to_owned(),
                category: "daily".to_owned(),
                days_of_week: vec!["Mon".to_owned()],
                duration_minutes: 10,
                start_ymd: None,
                auto_archive_after: None,
                repeat_count: None,
                is_active: true,
                created_at: "2026-01-01T00:00:00.000Z".to_owned(),
            };
            let mut transaction = pool.begin().await.unwrap();
            insert_task(&mut transaction, &existing).await.unwrap();
            transaction.commit().await.unwrap();

            let result = import_app_data(&pool, &sample_data()).await.unwrap();
            assert_eq!(result.skipped_existing_data, true);
            let loaded = load_app_data_from_pool(&pool).await.unwrap();
            assert_eq!(loaded.tasks.len(), 2);
            assert!(loaded.tasks.iter().any(|task| task.id == "existing"));
            assert!(loaded.tasks.iter().any(|task| task.id == "task-1"));
        });
    }

    #[test]
    fn failed_import_rolls_back_without_marking_migration_complete() {
        tauri::async_runtime::block_on(async {
            let pool = test_pool().await;
            sqlx::query("DROP TABLE task_daily_memos")
                .execute(&pool)
                .await
                .unwrap();

            assert!(import_app_data(&pool, &sample_data()).await.is_err());
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tasks")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count, 0);
            assert_eq!(migration_marker(&pool).await.unwrap(), None);
        });
    }

    #[test]
    fn auto_stop_transition_commits_entries_and_completions_together() {
        tauri::async_runtime::block_on(async {
            let pool = test_pool().await;
            let request = AutoStopTransitionRequest {
                time_entries: vec![TimeEntryRecord {
                    id: "entry-1".to_owned(),
                    task_id: "task-1".to_owned(),
                    date: "2026-01-05".to_owned(),
                    started_at: "2026-01-05T09:00:00.000Z".to_owned(),
                    ended_at: Some("2026-01-05T09:30:00.000Z".to_owned()),
                    minutes: 30,
                }],
                completions: vec![CompletionRecord {
                    task_id: "task-1".to_owned(),
                    date: "2026-01-05".to_owned(),
                }],
            };

            save_auto_stop_transition_to_pool(&pool, &request)
                .await
                .unwrap();

            let entries: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM time_entries")
                .fetch_one(&pool)
                .await
                .unwrap();
            let completions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM completions")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(entries, 1);
            assert_eq!(completions, 1);
        });
    }

    #[test]
    fn failed_auto_stop_transition_rolls_back_all_records() {
        tauri::async_runtime::block_on(async {
            let pool = test_pool().await;
            sqlx::query(
                "CREATE TRIGGER fail_auto_stop_completion
                 BEFORE INSERT ON completions
                 BEGIN SELECT RAISE(ABORT, 'completion insert failed'); END",
            )
            .execute(&pool)
            .await
            .unwrap();
            let request = AutoStopTransitionRequest {
                time_entries: vec![TimeEntryRecord {
                    id: "entry-1".to_owned(),
                    task_id: "task-1".to_owned(),
                    date: "2026-01-05".to_owned(),
                    started_at: "2026-01-05T09:00:00.000Z".to_owned(),
                    ended_at: Some("2026-01-05T09:30:00.000Z".to_owned()),
                    minutes: 30,
                }],
                completions: vec![CompletionRecord {
                    task_id: "task-1".to_owned(),
                    date: "2026-01-05".to_owned(),
                }],
            };

            assert!(save_auto_stop_transition_to_pool(&pool, &request)
                .await
                .is_err());
            let entries: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM time_entries")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(entries, 0);
        });
    }
}
