pub mod commands;
pub mod diagnostics;
pub mod error;
pub mod instagram;
pub mod media;
pub mod security;
pub mod selftest;
pub mod threads;
pub mod validate;

/// The complete native command surface. There is no generic fetch, filesystem,
/// shell, opener, dialog, process, or plugin command registered.
pub fn builder<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.invoke_handler(tauri::generate_handler![
        commands::resolve_instagram,
        commands::resolve_threads,
        commands::save_media,
        commands::security_self_check,
        commands::app_info
    ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    builder(tauri::Builder::default())
        .run(tauri::generate_context!())
        .expect("error while running UniFetch L2A");
}
