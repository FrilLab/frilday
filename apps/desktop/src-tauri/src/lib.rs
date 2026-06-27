use std::{fs, path::PathBuf};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_store::Builder::new().build())
    .plugin(tauri_plugin_sql::Builder::default().build())
    .plugin(tauri_plugin_notification::init())
    .setup(|app| {
      migrate_legacy_app_data_dir(app.handle())?;

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

fn migrate_legacy_app_data_dir(app: &tauri::AppHandle) -> tauri::Result<()> {
  const DB_FILE_NAME: &str = "daily_check.db";
  const LEGACY_IDENTIFIERS: [&str; 2] = ["com.mars112.dailycheck", "dailycheck"];

  let current_data_dir: PathBuf = match app.path().app_data_dir() {
    Ok(path) => path,
    Err(_) => return Ok(()),
  };

  if fs::metadata(current_data_dir.join(DB_FILE_NAME)).is_ok() {
    return Ok(());
  }

  let parent_dir = match current_data_dir.parent() {
    Some(parent) => parent.to_path_buf(),
    None => return Ok(()),
  };

  let legacy_db_path = match LEGACY_IDENTIFIERS
    .iter()
    .map(|identifier| parent_dir.join(identifier).join(DB_FILE_NAME))
    .find(|path| fs::metadata(path).is_ok())
  {
    Some(path) => path,
    None => return Ok(()),
  };

  if legacy_db_path == current_data_dir.join(DB_FILE_NAME) {
    return Ok(());
  }

  fs::create_dir_all(&current_data_dir)?;
  fs::copy(&legacy_db_path, current_data_dir.join(DB_FILE_NAME))?;

  Ok(())
}
