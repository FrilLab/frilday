use serde::Deserialize;
use serde_json::Value;
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool};

const DB_URL: &str = "sqlite:daily_check.db";

#[derive(Debug, Deserialize)]
pub struct SqlStatement {
    sql: String,
    #[serde(default)]
    bind: Vec<Value>,
}

#[tauri::command]
pub async fn execute_app_transaction(
    db_instances: State<'_, DbInstances>,
    statements: Vec<SqlStatement>,
) -> Result<(), String> {
    let pool = {
        let instances = db_instances.0.read().await;
        match instances.get(DB_URL) {
            Some(DbPool::Sqlite(pool)) => pool.clone(),
            None => return Err(format!("Database is not loaded: {DB_URL}")),
        }
    };

    execute_transaction(&pool, statements).await
}

async fn execute_transaction(
    pool: &sqlx::Pool<sqlx::Sqlite>,
    statements: Vec<SqlStatement>,
) -> Result<(), String> {
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("Failed to begin app data transaction: {error}"))?;

    for (index, statement) in statements.into_iter().enumerate() {
        let mut query = sqlx::query(&statement.sql);
        for value in statement.bind {
            if value.is_null() {
                query = query.bind(None::<Value>);
            } else if value.is_string() {
                query = query.bind(value.as_str().unwrap_or_default().to_owned());
            } else if let Some(number) = value.as_number() {
                query = query.bind(number.as_f64().unwrap_or_default());
            } else {
                query = query.bind(value);
            }
        }

        if let Err(error) = query.execute(&mut *transaction).await {
            let message = format!("Failed to execute app data statement {index}: {error}");
            if let Err(rollback_error) = transaction.rollback().await {
                return Err(format!("{message}; rollback failed: {rollback_error}"));
            }
            return Err(message);
        }
    }

    transaction
        .commit()
        .await
        .map_err(|error| format!("Failed to commit app data transaction: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    #[test]
    fn commits_all_statements_as_one_transaction() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();

            sqlx::query("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)")
                .execute(&pool)
                .await
                .unwrap();

            execute_transaction(
                &pool,
                vec![SqlStatement {
                    sql: "INSERT INTO items (name) VALUES (?)".to_owned(),
                    bind: vec![Value::String("saved".to_owned())],
                }],
            )
            .await
            .unwrap();

            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM items")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count, 1);
        });
    }

    #[test]
    fn rolls_back_all_statements_when_one_fails() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePoolOptions::new()
                .max_connections(1)
                .connect("sqlite::memory:")
                .await
                .unwrap();

            sqlx::query("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)")
                .execute(&pool)
                .await
                .unwrap();

            let result = execute_transaction(
                &pool,
                vec![
                    SqlStatement {
                        sql: "INSERT INTO items (name) VALUES (?)".to_owned(),
                        bind: vec![Value::String("rolled back".to_owned())],
                    },
                    SqlStatement {
                        sql: "INSERT INTO missing (name) VALUES (?)".to_owned(),
                        bind: vec![Value::String("failure".to_owned())],
                    },
                ],
            )
            .await;

            assert!(result.is_err());
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM items")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count, 0);
        });
    }
}
