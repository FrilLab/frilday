use std::{fs, path::{Path, PathBuf}};

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

fn find_legacy_database(config_root: &Path) -> Option<PathBuf> {
  LEGACY_IDENTIFIERS
    .iter()
    .map(|identifier| config_root.join(identifier).join(DB_FILE_NAME))
    .find(|path| fs::metadata(path).is_ok())
}

pub fn migrate_legacy_app_config_dir(app: &tauri::AppHandle) -> tauri::Result<()> {
  let current_config_dir: PathBuf = match app.path().app_config_dir() {
    Ok(path) => path,
    Err(_) => return Ok(()),
  };

  let current_db_path = current_config_dir.join(DB_FILE_NAME);
  if fs::metadata(&current_db_path).is_ok() {
    return Ok(());
  }

  let config_root = match current_config_dir.parent() {
    Some(parent) => parent.to_path_buf(),
    None => return Ok(()),
  };

  let legacy_db_path = match find_legacy_database(&config_root) {
    Some(path) => path,
    None => return Ok(()),
  };

  fs::create_dir_all(&current_config_dir)?;
  fs::copy(legacy_db_path, current_db_path)?;

  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::time::{SystemTime, UNIX_EPOCH};

  #[test]
  fn finds_legacy_database_in_the_config_root() {
    let nonce = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .expect("system clock should be after Unix epoch")
      .as_nanos();
    let root = std::env::temp_dir().join(format!(
      "frilday-migration-test-{}-{nonce}",
      std::process::id()
    ));
    let legacy_db_path = root.join("app.dailycheck").join(DB_FILE_NAME);

    fs::create_dir_all(legacy_db_path.parent().expect("database has a parent"))
      .expect("legacy config directory should be created");
    fs::write(&legacy_db_path, b"legacy database")
      .expect("legacy database should be created");

    assert_eq!(find_legacy_database(&root), Some(legacy_db_path));

    fs::remove_dir_all(root).expect("temporary migration directory should be removed");
  }
}
