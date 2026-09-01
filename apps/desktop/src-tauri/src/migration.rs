use std::{fs, path::PathBuf};

use tauri::Manager;

// This filename is persisted user data; changing it requires a migration.
const DB_FILE_NAME: &str = "daily_check.db";
// Keep all prior identifiers so changing the product identifier does not
// strand an existing local database.
const LEGACY_IDENTIFIERS: [&str; 3] = [
  "app.dailycheck",
  "com.mars112.dailycheck",
  "dailycheck",
];

pub fn migrate_legacy_app_data_dir(app: &tauri::AppHandle) -> tauri::Result<()> {
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
