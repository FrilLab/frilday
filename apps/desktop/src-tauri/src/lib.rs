mod bootstrap;
mod migration;
mod persistence;
mod plugins;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            persistence::execute_app_transaction
        ])
        .setup(bootstrap::setup)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
