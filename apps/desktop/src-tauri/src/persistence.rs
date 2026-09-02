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
    // The SQLite columns keep their legacy names for on-disk compatibility;
    // the adapter exposes the explicit routine meanings to React.
    pub completion_limit: Option<u32>,
    pub occurrence_limit: Option<u32>,
    pub is_active: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompletionRecord {
    pub task_id: String,
    #[serde(default)]
    pub plan_id: Option<String>,
    pub date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlanRecord {
    pub id: String,
    pub routine_id: Option<String>,
    pub date: String,
    pub baseline_duration_minutes: u32,
    pub duration_override_minutes: Option<u32>,
    pub status: String,
    pub moved_to_ymd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimeEntryRecord {
    pub id: String,
    pub task_id: String,
    #[serde(default)]
    pub plan_id: Option<String>,
    pub date: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    #[serde(default)]
    pub paused_at: Option<String>,
    #[serde(default)]
    pub active_started_at: Option<String>,
    #[serde(default)]
    pub accumulated_millis: u64,
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
    #[serde(default)]
    pub plans: Vec<PlanRecord>,
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
    #[serde(default)]
    pub plan_id: Option<String>,
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
    plan_id: Option<String>,
    date: String,
}

#[derive(Debug, FromRow)]
struct PlanRow {
    id: String,
    routine_id: Option<String>,
    date: String,
    baseline_duration_minutes: i64,
    duration_override_minutes: Option<i64>,
    status: String,
    moved_to_ymd: Option<String>,
}

#[derive(Debug, FromRow)]
struct TimeEntryRow {
    id: String,
    task_id: String,
    plan_id: Option<String>,
    date: String,
    started_at: String,
    ended_at: Option<String>,
    paused_at: Option<String>,
    active_started_at: Option<String>,
    accumulated_millis: i64,
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
            plan_id TEXT,
            date TEXT NOT NULL,
            PRIMARY KEY (task_id, date)
        )",
        "CREATE TABLE IF NOT EXISTS plans (
            id TEXT PRIMARY KEY,
            routine_id TEXT,
            date TEXT NOT NULL,
            baseline_duration_minutes INTEGER NOT NULL,
            duration_override_minutes INTEGER,
            status TEXT NOT NULL,
            moved_to_ymd TEXT,
            UNIQUE (routine_id, date)
        )",
        "CREATE TABLE IF NOT EXISTS time_entries (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            plan_id TEXT,
            date TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT,
            paused_at TEXT,
            active_started_at TEXT,
            accumulated_millis INTEGER NOT NULL DEFAULT 0,
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

    let completion_columns: Vec<String> =
        sqlx::query_scalar("SELECT name FROM pragma_table_info('completions')")
            .fetch_all(pool)
            .await
            .map_err(|error| format!("Failed to inspect completion schema: {error}"))?;
    if !completion_columns.iter().any(|column| column == "plan_id") {
        sqlx::query("ALTER TABLE completions ADD COLUMN plan_id TEXT")
            .execute(pool)
            .await
            .map_err(|error| format!("Failed to migrate completion schema: {error}"))?;
    }

    // Existing installations have the original six-column time_entries table.
    // Add lifecycle columns in place so the persisted database filename and
    // legacy records remain usable.
    let columns: Vec<String> =
        sqlx::query_scalar("SELECT name FROM pragma_table_info('time_entries')")
            .fetch_all(pool)
            .await
            .map_err(|error| format!("Failed to inspect time entry schema: {error}"))?;
    for (name, definition) in [
        ("paused_at", "TEXT"),
        ("active_started_at", "TEXT"),
        ("accumulated_millis", "INTEGER NOT NULL DEFAULT 0"),
        ("plan_id", "TEXT"),
    ] {
        if !columns.iter().any(|column| column == name) {
            sqlx::query(&format!(
                "ALTER TABLE time_entries ADD COLUMN {name} {definition}"
            ))
            .execute(pool)
            .await
            .map_err(|error| format!("Failed to migrate time entry schema: {error}"))?;
        }
    }

    backfill_historical_plans(pool).await?;

    Ok(())
}

/// Give pre-Plan completions and time entries a stable date-specific identity
/// without rewriting their existing rows. The Routine default is the only
/// historical baseline available to the legacy schema, so it is snapshotted
/// once and never replaced on later Routine edits.
async fn backfill_historical_plans(pool: &SqlitePool) -> Result<(), String> {
    let routines: Vec<(String, i64)> = sqlx::query_as("SELECT id, duration_minutes FROM tasks")
        .fetch_all(pool)
        .await
        .map_err(|error| format!("Failed to read routines for Plan migration: {error}"))?;

    let historical_dates: Vec<(String, String)> = sqlx::query_as(
        "SELECT task_id, date FROM completions
         UNION
         SELECT task_id, date FROM time_entries",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Failed to read history for Plan migration: {error}"))?;

    for (routine_id, date) in historical_dates {
        let Some((_, duration_minutes)) = routines
            .iter()
            .find(|(candidate, _)| candidate == &routine_id)
        else {
            continue;
        };
        let Ok(duration_minutes) = u32::try_from(*duration_minutes) else {
            continue;
        };
        if duration_minutes == 0 {
            continue;
        }
        let plan_id = format!("routine-plan:{}:{}:{}", routine_id.len(), routine_id, date);
        sqlx::query(
            "INSERT INTO plans (
                id, routine_id, date, baseline_duration_minutes,
                duration_override_minutes, status, moved_to_ymd
             ) VALUES (?, ?, ?, ?, NULL, 'planned', NULL)
             ON CONFLICT DO NOTHING",
        )
        .bind(&plan_id)
        .bind(&routine_id)
        .bind(&date)
        .bind(i64::from(duration_minutes))
        .execute(pool)
        .await
        .map_err(|error| format!("Failed to migrate historical Plan: {error}"))?;

        sqlx::query(
            "UPDATE time_entries SET plan_id = ?
             WHERE task_id = ? AND date = ? AND plan_id IS NULL",
        )
        .bind(&plan_id)
        .bind(&routine_id)
        .bind(&date)
        .execute(pool)
        .await
        .map_err(|error| format!("Failed to link historical Session to Plan: {error}"))?;

        sqlx::query(
            "UPDATE completions SET plan_id = ?
             WHERE task_id = ? AND date = ? AND plan_id IS NULL",
        )
        .bind(&plan_id)
        .bind(&routine_id)
        .bind(&date)
        .execute(pool)
        .await
        .map_err(|error| format!("Failed to link historical Completion to Plan: {error}"))?;
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
        "SELECT task_id, plan_id, date FROM completions ORDER BY date DESC, task_id ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("Failed to load completions: {error}"))?;

    let time_entry_rows = sqlx::query_as::<_, TimeEntryRow>(
        "SELECT id, task_id, plan_id, date, started_at, ended_at, paused_at,
                active_started_at, accumulated_millis, minutes
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
                plan_id: row.plan_id,
                date: row.date,
            })
            .collect(),
        plans: sqlx::query_as::<_, PlanRow>(
            "SELECT id, routine_id, date, baseline_duration_minutes,
                    duration_override_minutes, status, moved_to_ymd
             FROM plans ORDER BY date ASC, id ASC",
        )
        .fetch_all(pool)
        .await
        .map_err(|error| format!("Failed to load plans: {error}"))?
        .into_iter()
        .map(plan_from_row)
        .collect::<Result<Vec<_>, _>>()?,
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
        completion_limit: row
            .auto_archive_after
            .map(u32::try_from)
            .transpose()
            .map_err(|_| "Task archive threshold is invalid".to_owned())?,
        occurrence_limit: row
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
        plan_id: row.plan_id,
        date: row.date,
        started_at: row.started_at,
        ended_at: row.ended_at,
        paused_at: row.paused_at,
        active_started_at: row.active_started_at,
        accumulated_millis: u64::try_from(row.accumulated_millis)
            .map_err(|_| "Time entry accumulated duration is invalid".to_owned())?,
        minutes: u32::try_from(row.minutes)
            .map_err(|_| "Time entry duration is outside the supported range".to_owned())?,
    })
}

fn plan_from_row(row: PlanRow) -> Result<PlanRecord, String> {
    Ok(PlanRecord {
        id: row.id,
        routine_id: row.routine_id,
        date: row.date,
        baseline_duration_minutes: u32::try_from(row.baseline_duration_minutes)
            .map_err(|_| "Plan baseline duration is invalid".to_owned())?,
        duration_override_minutes: row
            .duration_override_minutes
            .map(u32::try_from)
            .transpose()
            .map_err(|_| "Plan duration override is invalid".to_owned())?,
        status: row.status,
        moved_to_ymd: row.moved_to_ymd,
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
    let tables = [
        "tasks",
        "completions",
        "plans",
        "time_entries",
        "task_daily_memos",
    ];
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
    .bind(task.completion_limit.map(i64::from))
    .bind(task.occurrence_limit.map(i64::from))
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
    .bind(task.completion_limit.map(i64::from))
    .bind(task.occurrence_limit.map(i64::from))
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
    sqlx::query(
        "INSERT INTO completions (task_id, plan_id, date) VALUES (?, ?, ?)
         ON CONFLICT DO NOTHING",
    )
    .bind(&completion.task_id)
    .bind(&completion.plan_id)
    .bind(&completion.date)
    .execute(&mut **executor)
    .await
    .map(|_| ())
    .map_err(|error| format!("Failed to save completion: {error}"))
}

async fn insert_plan(
    executor: &mut Transaction<'_, Sqlite>,
    plan: &PlanRecord,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO plans (
            id, routine_id, date, baseline_duration_minutes,
            duration_override_minutes, status, moved_to_ymd
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            routine_id = excluded.routine_id,
            date = excluded.date,
            baseline_duration_minutes = excluded.baseline_duration_minutes,
            duration_override_minutes = excluded.duration_override_minutes,
            status = excluded.status,
            moved_to_ymd = excluded.moved_to_ymd",
    )
    .bind(&plan.id)
    .bind(&plan.routine_id)
    .bind(&plan.date)
    .bind(i64::from(plan.baseline_duration_minutes))
    .bind(plan.duration_override_minutes.map(i64::from))
    .bind(&plan.status)
    .bind(&plan.moved_to_ymd)
    .execute(&mut **executor)
    .await
    .map(|_| ())
    .map_err(|error| format!("Failed to save plan: {error}"))
}

async fn insert_plan_if_absent(
    executor: &mut Transaction<'_, Sqlite>,
    plan: &PlanRecord,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO plans (
            id, routine_id, date, baseline_duration_minutes,
            duration_override_minutes, status, moved_to_ymd
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING",
    )
    .bind(&plan.id)
    .bind(&plan.routine_id)
    .bind(&plan.date)
    .bind(i64::from(plan.baseline_duration_minutes))
    .bind(plan.duration_override_minutes.map(i64::from))
    .bind(&plan.status)
    .bind(&plan.moved_to_ymd)
    .execute(&mut **executor)
    .await
    .map(|_| ())
    .map_err(|error| format!("Failed to import plan: {error}"))
}

async fn insert_time_entry(
    executor: &mut Transaction<'_, Sqlite>,
    entry: &TimeEntryRecord,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO time_entries (
            id, task_id, plan_id, date, started_at, ended_at, paused_at,
            active_started_at, accumulated_millis, minutes
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            task_id = excluded.task_id,
            plan_id = excluded.plan_id,
            date = excluded.date,
            started_at = excluded.started_at,
            ended_at = excluded.ended_at,
            paused_at = excluded.paused_at,
            active_started_at = excluded.active_started_at,
            accumulated_millis = excluded.accumulated_millis,
            minutes = excluded.minutes",
    )
    .bind(&entry.id)
    .bind(&entry.task_id)
    .bind(&entry.plan_id)
    .bind(&entry.date)
    .bind(&entry.started_at)
    .bind(&entry.ended_at)
    .bind(&entry.paused_at)
    .bind(&entry.active_started_at)
    .bind(
        i64::try_from(entry.accumulated_millis).map_err(|_| {
            "Time entry accumulated duration is outside the supported range".to_owned()
        })?,
    )
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
        "INSERT INTO time_entries (
            id, task_id, plan_id, date, started_at, ended_at, paused_at,
            active_started_at, accumulated_millis, minutes
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING",
    )
    .bind(&entry.id)
    .bind(&entry.task_id)
    .bind(&entry.plan_id)
    .bind(&entry.date)
    .bind(&entry.started_at)
    .bind(&entry.ended_at)
    .bind(&entry.paused_at)
    .bind(&entry.active_started_at)
    .bind(
        i64::try_from(entry.accumulated_millis).map_err(|_| {
            "Time entry accumulated duration is outside the supported range".to_owned()
        })?,
    )
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
    for plan in &data.plans {
        insert_plan_if_absent(&mut transaction, plan).await?;
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

    backfill_historical_plans(pool).await?;

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
pub async fn save_plan(
    db_instances: State<'_, DbInstances>,
    plan: PlanRecord,
) -> Result<(), String> {
    let pool = database_pool(&db_instances).await?;
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("Failed to begin app data transaction: {error}"))?;
    insert_plan(&mut transaction, &plan).await?;
    transaction
        .commit()
        .await
        .map_err(|error| format!("Failed to commit app data transaction: {error}"))
}

#[tauri::command]
pub async fn delete_plan(
    db_instances: State<'_, DbInstances>,
    plan_id: String,
) -> Result<(), String> {
    let pool = database_pool(&db_instances).await?;
    sqlx::query("DELETE FROM plans WHERE id = ?")
        .bind(plan_id)
        .execute(&pool)
        .await
        .map(|_| ())
        .map_err(|error| format!("Failed to remove plan: {error}"))
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
    sqlx::query("DELETE FROM plans WHERE routine_id = ?")
        .bind(&task_id)
        .execute(&mut *transaction)
        .await
        .map_err(|error| format!("Failed to delete task plans: {error}"))?;
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
        sqlx::query(
            "INSERT INTO completions (task_id, plan_id, date) VALUES (?, ?, ?)
             ON CONFLICT(task_id, date) DO UPDATE SET plan_id = excluded.plan_id",
        )
        .bind(request.task_id)
        .bind(request.plan_id)
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
                completion_limit: None,
                occurrence_limit: None,
                is_active: true,
                created_at: "2026-01-01T00:00:00.000Z".to_owned(),
            }],
            completions: vec![CompletionRecord {
                task_id: "task-1".to_owned(),
                plan_id: Some("routine-plan:6:task-1:2026-01-05".to_owned()),
                date: "2026-01-05".to_owned(),
            }],
            plans: vec![PlanRecord {
                id: "routine-plan:6:task-1:2026-01-05".to_owned(),
                routine_id: Some("task-1".to_owned()),
                date: "2026-01-05".to_owned(),
                baseline_duration_minutes: 30,
                duration_override_minutes: None,
                status: "planned".to_owned(),
                moved_to_ymd: None,
            }],
            time_entries: vec![TimeEntryRecord {
                id: "entry-1".to_owned(),
                task_id: "task-1".to_owned(),
                plan_id: Some("routine-plan:6:task-1:2026-01-05".to_owned()),
                date: "2026-01-05".to_owned(),
                started_at: "2026-01-05T09:00:00.000Z".to_owned(),
                ended_at: None,
                paused_at: Some("2026-01-05T09:30:00.000Z".to_owned()),
                active_started_at: None,
                accumulated_millis: 1_800_000,
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

    fn representative_legacy_data() -> AppData {
        AppData {
            tasks: vec![
                TaskRecord {
                    id: "active-weekday".to_owned(),
                    title: "English study".to_owned(),
                    description: "Review vocabulary".to_owned(),
                    category: "weekday".to_owned(),
                    days_of_week: vec![
                        "Mon".to_owned(),
                        "Tue".to_owned(),
                        "Wed".to_owned(),
                        "Thu".to_owned(),
                        "Fri".to_owned(),
                    ],
                    duration_minutes: 45,
                    start_ymd: Some("2026-01-05".to_owned()),
                    completion_limit: Some(3),
                    occurrence_limit: Some(5),
                    is_active: true,
                    created_at: "2026-01-01T08:00:00.000Z".to_owned(),
                },
                TaskRecord {
                    id: "archived-weekend".to_owned(),
                    title: "Weekend planning".to_owned(),
                    description: "Historical routine".to_owned(),
                    category: "weekend".to_owned(),
                    days_of_week: vec!["Sat".to_owned(), "Sun".to_owned()],
                    duration_minutes: 20,
                    start_ymd: None,
                    completion_limit: Some(2),
                    occurrence_limit: None,
                    is_active: false,
                    created_at: "2025-12-01T08:00:00.000Z".to_owned(),
                },
                TaskRecord {
                    id: "active-custom".to_owned(),
                    title: "Project writing".to_owned(),
                    description: "Draft the next section".to_owned(),
                    category: "custom".to_owned(),
                    days_of_week: vec!["Tue".to_owned(), "Thu".to_owned()],
                    duration_minutes: 60,
                    start_ymd: Some("2026-01-06".to_owned()),
                    completion_limit: Some(4),
                    occurrence_limit: None,
                    is_active: true,
                    created_at: "2026-01-02T08:00:00.000Z".to_owned(),
                },
            ],
            completions: vec![
                CompletionRecord {
                    task_id: "active-weekday".to_owned(),
                    plan_id: None,
                    date: "2026-01-05".to_owned(),
                },
                CompletionRecord {
                    task_id: "active-weekday".to_owned(),
                    plan_id: None,
                    date: "2026-01-12".to_owned(),
                },
                CompletionRecord {
                    task_id: "archived-weekend".to_owned(),
                    plan_id: None,
                    date: "2025-12-20".to_owned(),
                },
                CompletionRecord {
                    task_id: "active-custom".to_owned(),
                    plan_id: None,
                    date: "2026-01-06".to_owned(),
                },
            ],
            plans: vec![],
            time_entries: vec![
                TimeEntryRecord {
                    id: "entry-active-history".to_owned(),
                    task_id: "active-weekday".to_owned(),
                    plan_id: None,
                    date: "2025-12-29".to_owned(),
                    started_at: "2025-12-29T09:00:00.000Z".to_owned(),
                    ended_at: Some("2025-12-29T09:40:00.000Z".to_owned()),
                    paused_at: None,
                    active_started_at: None,
                    accumulated_millis: 0,
                    minutes: 40,
                },
                TimeEntryRecord {
                    id: "entry-active-running".to_owned(),
                    task_id: "active-weekday".to_owned(),
                    plan_id: None,
                    date: "2026-01-05".to_owned(),
                    started_at: "2026-01-05T10:00:00.000Z".to_owned(),
                    ended_at: None,
                    paused_at: None,
                    active_started_at: None,
                    accumulated_millis: 0,
                    minutes: 0,
                },
                TimeEntryRecord {
                    id: "entry-archived-history".to_owned(),
                    task_id: "archived-weekend".to_owned(),
                    plan_id: None,
                    date: "2025-12-20".to_owned(),
                    started_at: "2025-12-20T11:00:00.000Z".to_owned(),
                    ended_at: Some("2025-12-20T11:25:00.000Z".to_owned()),
                    paused_at: None,
                    active_started_at: None,
                    accumulated_millis: 0,
                    minutes: 25,
                },
                TimeEntryRecord {
                    id: "entry-custom".to_owned(),
                    task_id: "active-custom".to_owned(),
                    plan_id: None,
                    date: "2026-01-06".to_owned(),
                    started_at: "2026-01-06T14:00:00.000Z".to_owned(),
                    ended_at: Some("2026-01-06T15:10:00.000Z".to_owned()),
                    paused_at: None,
                    active_started_at: None,
                    accumulated_millis: 0,
                    minutes: 70,
                },
            ],
            task_daily_memos: vec![
                TaskDailyMemoRecord {
                    id: "active-weekday_2025-12-29".to_owned(),
                    task_id: "active-weekday".to_owned(),
                    date: "2025-12-29".to_owned(),
                    text: "Historical note".to_owned(),
                    updated_at: "2025-12-29T10:00:00.000Z".to_owned(),
                },
                TaskDailyMemoRecord {
                    id: "active-custom_2026-01-06".to_owned(),
                    task_id: "active-custom".to_owned(),
                    date: "2026-01-06".to_owned(),
                    text: "Draft is progressing".to_owned(),
                    updated_at: "2026-01-06T15:15:00.000Z".to_owned(),
                },
            ],
        }
    }

    fn normalize_loaded_order(data: &mut AppData) {
        data.tasks
            .sort_by(|left, right| right.created_at.cmp(&left.created_at));
        data.completions.sort_by(|left, right| {
            right
                .date
                .cmp(&left.date)
                .then_with(|| left.task_id.cmp(&right.task_id))
        });
        data.time_entries
            .sort_by(|left, right| right.started_at.cmp(&left.started_at));
        data.task_daily_memos
            .sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        data.plans.sort_by(|left, right| {
            left.date
                .cmp(&right.date)
                .then_with(|| left.id.cmp(&right.id))
        });
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
    fn upgrades_the_original_time_entry_schema_in_place() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            sqlx::query(
                "CREATE TABLE time_entries (
                    id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    date TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    ended_at TEXT,
                    minutes INTEGER NOT NULL
                )",
            )
            .execute(&pool)
            .await
            .unwrap();

            initialize_schema(&pool).await.unwrap();

            let columns: Vec<String> =
                sqlx::query_scalar("SELECT name FROM pragma_table_info('time_entries')")
                    .fetch_all(&pool)
                    .await
                    .unwrap();
            assert!(columns.iter().any(|column| column == "paused_at"));
            assert!(columns.iter().any(|column| column == "active_started_at"));
            assert!(columns.iter().any(|column| column == "accumulated_millis"));

            sqlx::query(
                "INSERT INTO time_entries
                 (id, task_id, date, started_at, ended_at, minutes)
                 VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind("legacy-entry")
            .bind("task-1")
            .bind("2026-01-05")
            .bind("2026-01-05T09:00:00.000Z")
            .bind(Option::<String>::None)
            .bind(0_i64)
            .execute(&pool)
            .await
            .unwrap();

            let loaded = load_app_data_from_pool(&pool).await.unwrap();
            let entry = &loaded.time_entries[0];
            assert_eq!(entry.id, "legacy-entry");
            assert_eq!(entry.paused_at, None);
            assert_eq!(entry.active_started_at, None);
            assert_eq!(entry.accumulated_millis, 0);
        });
    }

    #[test]
    fn backfills_plan_identity_for_an_existing_legacy_database() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();
            sqlx::query(
                "CREATE TABLE tasks (
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
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "CREATE TABLE completions (
                    task_id TEXT NOT NULL,
                    date TEXT NOT NULL,
                    PRIMARY KEY (task_id, date)
                )",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "CREATE TABLE time_entries (
                    id TEXT PRIMARY KEY,
                    task_id TEXT NOT NULL,
                    date TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    ended_at TEXT,
                    minutes INTEGER NOT NULL
                )",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO tasks (
                    id, title, description, category, days_of_week,
                    duration_minutes, start_ymd, auto_archive_after,
                    repeat_count, is_active, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind("legacy-task")
            .bind("Focus")
            .bind("")
            .bind("weekday")
            .bind("[\"Mon\"]")
            .bind(30_i64)
            .bind(Option::<String>::None)
            .bind(Option::<i64>::None)
            .bind(Option::<i64>::None)
            .bind(1_i64)
            .bind("2026-01-01T00:00:00.000Z")
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query("INSERT INTO completions (task_id, date) VALUES (?, ?)")
                .bind("legacy-task")
                .bind("2026-01-05")
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query(
                "INSERT INTO time_entries
                 (id, task_id, date, started_at, ended_at, minutes)
                 VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind("legacy-entry")
            .bind("legacy-task")
            .bind("2026-01-05")
            .bind("2026-01-05T09:00:00.000Z")
            .bind("2026-01-05T09:30:00.000Z")
            .bind(30_i64)
            .execute(&pool)
            .await
            .unwrap();

            initialize_schema(&pool).await.unwrap();

            let expected_id = "routine-plan:11:legacy-task:2026-01-05";
            let loaded = load_app_data_from_pool(&pool).await.unwrap();
            assert_eq!(loaded.plans.len(), 1);
            assert_eq!(loaded.plans[0].id, expected_id);
            assert_eq!(loaded.plans[0].baseline_duration_minutes, 30);
            assert_eq!(loaded.completions[0].plan_id.as_deref(), Some(expected_id));
            assert_eq!(loaded.time_entries[0].plan_id.as_deref(), Some(expected_id));

            initialize_schema(&pool).await.unwrap();
            let plan_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM plans")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(plan_count, 1);
        });
    }

    #[test]
    fn imports_and_loads_all_desktop_records() {
        tauri::async_runtime::block_on(async {
            let pool = test_pool().await;
            let data = sample_data();

            let result = import_app_data(&pool, &data).await.unwrap();
            assert!(result.imported);
            assert_eq!(load_app_data_from_pool(&pool).await.unwrap(), data);
        });
    }

    #[test]
    fn updating_routine_defaults_does_not_touch_historical_records() {
        tauri::async_runtime::block_on(async {
            let pool = test_pool().await;
            let data = sample_data();
            import_app_data(&pool, &data).await.unwrap();

            let mut updated_task = data.tasks[0].clone();
            updated_task.title = "Updated routine".to_owned();
            updated_task.duration_minutes = 60;
            updated_task.category = "daily".to_owned();
            updated_task.days_of_week = vec!["Mon".to_owned()];
            updated_task.is_active = false;

            let mut transaction = pool.begin().await.unwrap();
            insert_task(&mut transaction, &updated_task).await.unwrap();
            transaction.commit().await.unwrap();

            let loaded = load_app_data_from_pool(&pool).await.unwrap();
            assert_eq!(loaded.tasks[0], updated_task);
            assert_eq!(loaded.completions, data.completions);
            assert_eq!(loaded.time_entries, data.time_entries);
            assert_eq!(loaded.task_daily_memos, data.task_daily_memos);
        });
    }

    #[test]
    fn imports_representative_legacy_history_without_resetting_the_database() {
        tauri::async_runtime::block_on(async {
            let pool = test_pool().await;
            let data = representative_legacy_data();

            import_app_data(&pool, &data).await.unwrap();

            let mut loaded = load_app_data_from_pool(&pool).await.unwrap();
            let mut expected = data.clone();
            for (routine_id, date, duration) in [
                ("active-weekday", "2025-12-29", 45),
                ("active-weekday", "2026-01-05", 45),
                ("active-weekday", "2026-01-12", 45),
                ("archived-weekend", "2025-12-20", 20),
                ("active-custom", "2026-01-06", 60),
            ] {
                let plan_id = format!("routine-plan:{}:{}:{}", routine_id.len(), routine_id, date);
                expected.plans.push(PlanRecord {
                    id: plan_id.clone(),
                    routine_id: Some(routine_id.to_owned()),
                    date: date.to_owned(),
                    baseline_duration_minutes: duration,
                    duration_override_minutes: None,
                    status: "planned".to_owned(),
                    moved_to_ymd: None,
                });
                for entry in &mut expected.time_entries {
                    if entry.task_id == routine_id && entry.date == date {
                        entry.plan_id = Some(plan_id.clone());
                    }
                }
                for completion in &mut expected.completions {
                    if completion.task_id == routine_id && completion.date == date {
                        completion.plan_id = Some(plan_id.clone());
                    }
                }
            }
            normalize_loaded_order(&mut loaded);
            normalize_loaded_order(&mut expected);
            assert_eq!(loaded, expected);
            assert_eq!(migration_marker(&pool).await.unwrap().as_deref(), Some("1"));

            let second = import_app_data(&pool, &data).await.unwrap();
            assert!(!second.imported);
            assert!(!second.skipped_existing_data);
            let mut reloaded = load_app_data_from_pool(&pool).await.unwrap();
            normalize_loaded_order(&mut reloaded);
            assert_eq!(reloaded, expected);
        });
    }

    #[test]
    fn migration_is_idempotent_and_does_not_duplicate_records() {
        tauri::async_runtime::block_on(async {
            let pool = test_pool().await;
            let data = sample_data();

            import_app_data(&pool, &data).await.unwrap();
            let second = import_app_data(&pool, &data).await.unwrap();
            assert!(!second.imported);

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
                completion_limit: None,
                occurrence_limit: None,
                is_active: true,
                created_at: "2026-01-01T00:00:00.000Z".to_owned(),
            };
            let mut transaction = pool.begin().await.unwrap();
            insert_task(&mut transaction, &existing).await.unwrap();
            transaction.commit().await.unwrap();

            let result = import_app_data(&pool, &sample_data()).await.unwrap();
            assert!(result.skipped_existing_data);
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
}
