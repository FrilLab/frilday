use tauri::{AppHandle, Result};

pub fn register_plugins(app: &AppHandle) -> Result<()> {
    if cfg!(debug_assertions) {
        app.plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )?;
    }

    Ok(())
}
