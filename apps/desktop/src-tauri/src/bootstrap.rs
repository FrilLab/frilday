use tauri::App;

use crate::{migration::migrate_legacy_app_config_dir, plugins::register_plugins};

pub fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
  migrate_legacy_app_config_dir(app.handle())?;
  register_plugins(app.handle())?;
  Ok(())
}
