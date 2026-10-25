use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::diagnostics::Diagnostic;
use crate::error::PocError;
use crate::media;
use crate::security;
use crate::{instagram, threads};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstagramFetchMeta {
    status: u16,
    content_type: Option<String>,
    bootstrap_status: u16,
    csrf_found: bool,
    shortcode: String,
    kind: &'static str,
    canonical_url: String,
    diagnostics: Vec<Diagnostic>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadsFetchMeta {
    status: u16,
    content_type: Option<String>,
    requested_username: String,
    requested_shortcode: String,
    final_username: String,
    final_shortcode: String,
    final_url: String,
    redirected: bool,
    html_bytes: usize,
    diagnostics: Vec<Diagnostic>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StageError {
    code: &'static str,
    message: &'static str,
    stage: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FetchError {
    error: StageError,
}

impl From<PocError> for FetchError {
    fn from(error: PocError) -> Self {
        Self {
            error: StageError {
                code: error.code,
                message: error.message,
                stage: error.stage,
            },
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssetInput {
    url: String,
    suggested_filename: String,
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let serialized =
        serde_json::to_vec_pretty(value).map_err(|_| "serialize failed".to_string())?;
    std::fs::write(path, serialized).map_err(|_| "write failed".to_string())
}

fn print_error(stage: &str, error: &PocError) {
    eprintln!(
        "{} failed: code={} stage={}",
        stage, error.code, error.stage
    );
}

async fn fetch_all(
    instagram_shortcode: &str,
    instagram_kind: &str,
    threads_username: &str,
    threads_shortcode: &str,
    out_dir: &Path,
) -> i32 {
    std::fs::create_dir_all(out_dir).expect("create evidence directory");
    let mut failed = false;

    match instagram::fetch(instagram_shortcode, instagram_kind).await {
        Ok(fetch) => {
            let meta = InstagramFetchMeta {
                status: fetch.status,
                content_type: fetch.content_type,
                bootstrap_status: fetch.bootstrap_status,
                csrf_found: fetch.csrf_found,
                shortcode: fetch.shortcode,
                kind: fetch.kind,
                canonical_url: fetch.canonical_url,
                diagnostics: fetch.diagnostics,
            };
            if let Err(error) = std::fs::write(out_dir.join("instagram-raw.json"), &fetch.body) {
                eprintln!("instagram raw write failed: {error}");
                failed = true;
            }
            if let Err(error) = write_json(&out_dir.join("instagram-fetch.json"), &meta) {
                eprintln!("instagram metadata write failed: {error}");
                failed = true;
            }
            println!(
                "instagram: status={} bootstrap={} csrf={} body_bytes={}",
                fetch.status,
                fetch.bootstrap_status,
                fetch.csrf_found,
                fetch.body.len()
            );
        }
        Err(error) => {
            print_error("instagram", &error);
            let _ = write_json(
                &out_dir.join("instagram-fetch.json"),
                &FetchError::from(error),
            );
            failed = true;
        }
    }

    match threads::fetch(threads_username, threads_shortcode).await {
        Ok(fetch) => {
            let meta = ThreadsFetchMeta {
                status: fetch.status,
                content_type: fetch.content_type,
                requested_username: fetch.requested_username,
                requested_shortcode: fetch.requested_shortcode,
                final_username: fetch.final_username,
                final_shortcode: fetch.final_shortcode,
                final_url: fetch.final_url,
                redirected: fetch.redirected,
                html_bytes: fetch.html.len(),
                diagnostics: fetch.diagnostics,
            };
            if let Err(error) = std::fs::write(out_dir.join("threads-raw.html"), &fetch.html) {
                eprintln!("threads raw write failed: {error}");
                failed = true;
            }
            if let Err(error) = write_json(&out_dir.join("threads-fetch.json"), &meta) {
                eprintln!("threads metadata write failed: {error}");
                failed = true;
            }
            println!(
                "threads: status={} redirected={} html_bytes={}",
                fetch.status,
                fetch.redirected,
                fetch.html.len()
            );
        }
        Err(error) => {
            print_error("threads", &error);
            let _ = write_json(
                &out_dir.join("threads-fetch.json"),
                &FetchError::from(error),
            );
            failed = true;
        }
    }

    if failed {
        1
    } else {
        0
    }
}

async fn save_from_file(asset_path: &Path, out_dir: &Path) -> i32 {
    let input = match std::fs::read(asset_path) {
        Ok(bytes) => match serde_json::from_slice::<AssetInput>(&bytes) {
            Ok(input) => input,
            Err(_) => {
                eprintln!("asset file is not valid JSON");
                return 1;
            }
        },
        Err(_) => {
            eprintln!("asset file could not be read");
            return 1;
        }
    };
    let root = out_dir.join("downloads");
    match media::download_to_root(&root, &input.url, &input.suggested_filename).await {
        Ok(saved) => {
            let stem = asset_path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("asset")
                .trim_end_matches("-asset")
                .to_string();
            let output = out_dir.join(format!("{stem}-save.json"));
            if let Err(error) = write_json(&output, &saved) {
                eprintln!("save evidence write failed: {error}");
                return 1;
            }
            println!(
                "saved: file={} bytes={} type={} sha256={}",
                saved.file_name, saved.bytes, saved.detected_type, saved.sha256
            );
            0
        }
        Err(error) => {
            print_error("save", &error);
            1
        }
    }
}

fn security_report(out: &Path) -> i32 {
    let report = security::run();
    if let Err(error) = write_json(out, &report) {
        eprintln!("security report write failed: {error}");
        return 1;
    }
    println!(
        "security: passed={} failed={}",
        report.passed, report.failed
    );
    if report.failed == 0 {
        0
    } else {
        1
    }
}

fn usage() -> i32 {
    eprintln!(
        "usage: unifetch-l2a --self-test <security <out.json> | fetch <ig-shortcode> <kind> <threads-user> <threads-shortcode> <out-dir> | save-from-file <asset.json> <out-dir>>"
    );
    2
}

pub fn run() -> i32 {
    let args: Vec<String> = std::env::args().skip(2).collect();
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(_) => {
            eprintln!("could not initialize the async runtime");
            return 1;
        }
    };
    match args.as_slice() {
        [command, out] if command == "security" => security_report(Path::new(out)),
        [command, shortcode, kind, username, threads_shortcode, out] if command == "fetch" => {
            runtime.block_on(fetch_all(
                shortcode,
                kind,
                username,
                threads_shortcode,
                &PathBuf::from(out),
            ))
        }
        [command, asset, out] if command == "save-from-file" => {
            runtime.block_on(save_from_file(Path::new(asset), &PathBuf::from(out)))
        }
        _ => usage(),
    }
}
