mod bootstrap;
mod core_commands;
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
            persistence::execute_app_transaction,
            core_commands::core_visible_schedule,
            core_commands::core_toggle_completion,
            core_commands::core_statistics,
            core_commands::core_time_totals,
            core_commands::core_running_task_id,
            core_commands::core_start_timer,
            core_commands::core_stop_timer,
            core_commands::core_auto_stop
        ])
        .setup(bootstrap::setup)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
