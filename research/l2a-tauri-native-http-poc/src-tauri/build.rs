fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "resolve_instagram",
            "resolve_threads",
            "save_media",
            "security_self_check",
            "app_info",
        ]),
    ))
    .expect("failed to run tauri-build");
}
