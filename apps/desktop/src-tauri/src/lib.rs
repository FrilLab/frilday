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
            persistence::initialize_app_database,
            persistence::load_app_data,
            persistence::import_legacy_app_data,
            persistence::save_task,
            persistence::save_plan,
            persistence::delete_plan,
            persistence::set_task_active,
            persistence::delete_task,
            persistence::set_completion,
            persistence::save_time_entries,
            persistence::save_task_daily_memo,
            persistence::get_setting,
            persistence::set_setting,
            persistence::get_migration_marker,
            persistence::set_migration_marker,
            core_commands::core_visible_schedule,
            core_commands::core_toggle_completion,
            core_commands::core_statistics,
            core_commands::core_time_totals,
            core_commands::core_running_task_id,
            core_commands::core_start_timer,
            core_commands::core_stop_timer,
            core_commands::core_pause_timer,
            core_commands::core_resume_timer,
            core_commands::core_target_reached
        ])
        .setup(bootstrap::setup)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
