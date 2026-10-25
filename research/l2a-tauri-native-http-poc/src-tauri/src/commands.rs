use serde::Serialize;
use tauri::Manager;

use crate::error::PocError;
use crate::instagram::{self, InstagramFetch};
use crate::media::{self, SaveResult};
use crate::security::{self, SecurityReport};
use crate::threads::{self, ThreadsFetch};
use crate::validate::{validate_media_url, INSTAGRAM_ORIGIN, MAX_MEDIA_BYTES, THREADS_ORIGIN};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: &'static str,
    pub version: &'static str,
    pub tauri_version: &'static str,
    pub instagram_origin: &'static str,
    pub threads_origin: &'static str,
    pub media_hosts: [&'static str; 2],
    pub max_media_bytes: usize,
    pub cookie_header_sent: bool,
    pub worker_used: bool,
}

/// Fixed-profile Instagram public metadata acquisition. The command accepts a
/// validated shortcode and kind, never a URL, header, or method.
#[tauri::command]
pub async fn resolve_instagram(
    shortcode: String,
    kind: String,
) -> Result<InstagramFetch, PocError> {
    instagram::fetch(&shortcode, &kind).await
}

/// One exact public Threads post. The command accepts a validated username and
/// shortcode, never a URL, header, or method.
#[tauri::command]
pub async fn resolve_threads(
    username: String,
    shortcode: String,
) -> Result<ThreadsFetch, PocError> {
    threads::fetch(&username, &shortcode).await
}

/// Downloads one parser-produced media URL into the app-controlled data
/// directory. The URL is revalidated against the HTTPS CDN allowlist and the
/// filename is sanitized; the frontend cannot choose a filesystem path.
#[tauri::command]
pub async fn save_media<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    url: String,
    suggested_filename: String,
) -> Result<SaveResult, PocError> {
    // Reject an untrusted URL before touching the filesystem or network.
    let validated = validate_media_url(&url)?;
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| PocError::save_failed("APP_DATA_DIR"))?
        .join("downloads");
    media::download_to_root(&root, validated.as_str(), &suggested_filename).await
}

#[tauri::command]
pub fn security_self_check() -> SecurityReport {
    security::run()
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "UniFetch L2A Native HTTP PoC",
        version: env!("CARGO_PKG_VERSION"),
        tauri_version: tauri::VERSION,
        instagram_origin: INSTAGRAM_ORIGIN,
        threads_origin: THREADS_ORIGIN,
        media_hosts: ["*.cdninstagram.com", "*.fbcdn.net"],
        max_media_bytes: MAX_MEDIA_BYTES,
        cookie_header_sent: false,
        worker_used: false,
    }
}
