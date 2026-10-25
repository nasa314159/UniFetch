use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, INVOKE_KEY};
use tauri::webview::InvokeRequest;

fn request(cmd: &str, body: InvokeBody) -> InvokeRequest {
    let local = if cfg!(any(windows, target_os = "android")) {
        "http://tauri.localhost"
    } else {
        "tauri://localhost"
    };
    request_from(cmd, body, local)
}

fn request_from(cmd: &str, body: InvokeBody, url: &str) -> InvokeRequest {
    InvokeRequest {
        cmd: cmd.into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: url.parse().expect("document URL"),
        body,
        headers: Default::default(),
        invoke_key: INVOKE_KEY.to_string(),
    }
}

fn app() -> tauri::App<tauri::test::MockRuntime> {
    unifetch_l2a_lib::builder(mock_builder())
        .build(tauri::generate_context!())
        .expect("build mock app")
}

#[test]
fn local_ipc_executes_the_security_command() {
    let app = app();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("build mock webview");
    let response = get_ipc_response(
        &webview,
        request("security_self_check", InvokeBody::default()),
    )
    .expect("security command is allowed for the local window");
    let value: Value = response.deserialize().expect("security JSON");
    assert_eq!(value["failed"], 0);
    assert!(value["passed"].as_u64().unwrap_or(0) >= 30);
}

#[test]
fn local_ipc_app_info_declares_no_worker_and_no_cookie_header() {
    let app = app();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("build mock webview");
    let response = get_ipc_response(&webview, request("app_info", InvokeBody::default()))
        .expect("app_info is allowed");
    let value: Value = response.deserialize().expect("app info JSON");
    assert_eq!(value["workerUsed"], false);
    assert_eq!(value["cookieHeaderSent"], false);
    assert_eq!(value["instagramOrigin"], "https://www.instagram.com");
    assert_eq!(value["threadsOrigin"], "https://www.threads.com");
}

#[test]
fn local_ipc_rejects_malformed_instagram_shortcode_before_network() {
    let app = app();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("build mock webview");
    let response = get_ipc_response(
        &webview,
        request(
            "resolve_instagram",
            InvokeBody::Json(json!({ "shortcode": "../etc/passwd", "kind": "post" })),
        ),
    );
    let error = response.expect_err("malformed shortcode must fail");
    assert_eq!(error["code"], "INVALID_URL");
    assert_eq!(error["stage"], "INSTAGRAM_REF");
}

#[test]
fn local_ipc_rejects_malformed_threads_username_before_network() {
    let app = app();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("build mock webview");
    let response = get_ipc_response(
        &webview,
        request(
            "resolve_threads",
            InvokeBody::Json(json!({ "username": "../../x", "shortcode": "Abc" })),
        ),
    );
    let error = response.expect_err("malformed username must fail");
    assert_eq!(error["code"], "INVALID_URL");
    assert_eq!(error["stage"], "THREADS_REF");
}

#[test]
fn local_ipc_rejects_non_https_media_url_before_filesystem_or_network() {
    let app = app();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("build mock webview");
    let response = get_ipc_response(
        &webview,
        request(
            "save_media",
            InvokeBody::Json(json!({
                "url": "http://127.0.0.1/private.jpg",
                "suggestedFilename": "../../escape.jpg"
            })),
        ),
    );
    let error = response.expect_err("non-HTTPS media URL must fail");
    assert_eq!(error["code"], "INVALID_URL");
    assert_eq!(error["stage"], "MEDIA_URL_SCHEME");
}

#[test]
fn remote_origin_cannot_invoke_the_local_command_surface() {
    let app = app();
    let webview = tauri::WebviewWindowBuilder::new(
        &app,
        "main",
        tauri::WebviewUrl::External("https://evil.example/".parse().expect("remote URL")),
    )
    .build()
    .expect("build mock remote webview");
    let response = get_ipc_response(
        &webview,
        request_from(
            "security_self_check",
            InvokeBody::default(),
            "https://evil.example/",
        ),
    );
    assert!(
        response.is_err(),
        "remote document must not reach a local-only command"
    );
}

#[test]
fn local_ipc_denies_unregistered_plugin_commands() {
    let app = app();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("build mock webview");
    let response = get_ipc_response(
        &webview,
        request(
            "plugin:fs|read_text_file",
            InvokeBody::Json(json!({ "path": "/etc/passwd" })),
        ),
    );
    assert!(
        response.is_err(),
        "unregistered plugin command must be denied"
    );
}
