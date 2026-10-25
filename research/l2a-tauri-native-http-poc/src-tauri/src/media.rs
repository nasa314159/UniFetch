use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, CONTENT_TYPE};
use reqwest::Client;
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::error::{PocError, PocResult};
use crate::validate::{content_length_allowed, validate_media_url, MAX_MEDIA_BYTES};

const USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MAX_REDIRECTS: usize = 3;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub file_name: String,
    pub saved_path: String,
    pub bytes: usize,
    pub sha256: String,
    pub detected_type: &'static str,
    pub mime_type: &'static str,
    pub exists: bool,
    pub non_empty: bool,
}

fn client() -> PocResult<Client> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|_| PocError::network("MEDIA_CLIENT"))
}

fn request_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        ACCEPT,
        HeaderValue::from_static(
            "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1",
        ),
    );
    headers
}

fn exceeds(total: usize, chunk: usize, max: usize) -> bool {
    total.saturating_add(chunk) > max
}

fn detect_image_type(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.len() >= 3 && bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff {
        return Some(("jpeg", "image/jpeg"));
    }
    if bytes.len() >= 8 && bytes[..8] == [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] {
        return Some(("png", "image/png"));
    }
    if bytes.len() >= 6 && (bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")) {
        return Some(("gif", "image/gif"));
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some(("webp", "image/webp"));
    }
    None
}

fn extension_for(detected_type: &str) -> &str {
    if detected_type == "jpeg" {
        "jpg"
    } else {
        detected_type
    }
}

fn sanitize_stem(suggested: &str) -> String {
    let base = suggested.rsplit(['/', '\\']).next().unwrap_or("").trim();
    let stem = Path::new(base)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    let mut cleaned = String::with_capacity(stem.len());
    for character in stem.chars() {
        if character.is_ascii_alphanumeric()
            || character == '-'
            || character == '_'
            || character == ' '
            || character == '.'
        {
            cleaned.push(character);
        } else {
            cleaned.push('_');
        }
    }
    let cleaned = cleaned.trim_matches(['.', ' ', '_']).trim();
    let mut limited: String = cleaned.chars().take(100).collect();
    while limited.ends_with('.') || limited.ends_with(' ') {
        limited.pop();
    }
    if limited.is_empty() {
        "unifetch_image".to_string()
    } else {
        limited
    }
}

fn unique_path(root: &Path, stem: &str, extension: &str) -> PathBuf {
    let first = root.join(format!("{stem}.{extension}"));
    if !first.exists() {
        return first;
    }
    for suffix in 2..=999 {
        let candidate = root.join(format!("{stem}-{suffix}.{extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    root.join(format!(
        "{stem}-{}.{extension}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_millis())
            .unwrap_or(0)
    ))
}

fn temp_path(root: &Path) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or(0);
    root.join(format!(".l2a-{}-{nanos}.part", std::process::id()))
}

async fn read_media(mut response: reqwest::Response) -> PocResult<Vec<u8>> {
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_ascii_lowercase());
    if let Some(value) = content_type.as_deref() {
        if !value.starts_with("image/") && !value.starts_with("application/octet-stream") {
            return Err(PocError::unexpected_content("MEDIA_CONTENT_TYPE"));
        }
    }
    if !content_length_allowed(response.content_length(), MAX_MEDIA_BYTES) {
        return Err(PocError::too_large("MEDIA_CONTENT_LENGTH"));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| PocError::network("MEDIA_BODY"))?
    {
        if exceeds(bytes.len(), chunk.len(), MAX_MEDIA_BYTES) {
            return Err(PocError::too_large("MEDIA_BODY"));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

/// Downloads one validated media URL and writes it under the supplied
/// application-controlled root. The caller never supplies a filesystem path.
/// Redirects are followed manually and every hop must remain on the audited
/// HTTPS CDN allowlist.
pub async fn download_to_root(
    root: &Path,
    url: &str,
    suggested_filename: &str,
) -> PocResult<SaveResult> {
    tokio::fs::create_dir_all(root)
        .await
        .map_err(|_| PocError::save_failed("MEDIA_CREATE_DIR"))?;
    let client = client()?;
    let mut current = validate_media_url(url)?;
    let mut response = None;

    for redirects in 0..=MAX_REDIRECTS {
        let sent = client
            .get(current.clone())
            .headers(request_headers())
            .send()
            .await
            .map_err(|_| PocError::network("MEDIA_REQUEST"))?;
        let status = sent.status().as_u16();
        match status {
            200 => {
                response = Some(sent);
                break;
            }
            301 | 302 | 303 | 307 | 308 => {
                if redirects == MAX_REDIRECTS {
                    return Err(PocError::redirect_rejected("MEDIA_REDIRECT_LIMIT"));
                }
                let location = sent
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .and_then(|value| value.to_str().ok())
                    .ok_or_else(|| PocError::redirect_rejected("MEDIA_REDIRECT_MISSING"))?;
                let next = current
                    .join(location)
                    .map_err(|_| PocError::redirect_rejected("MEDIA_REDIRECT_LOCATION"))?;
                current = validate_media_url(next.as_str())?;
            }
            401 | 403 => return Err(PocError::unavailable("MEDIA_STATUS")),
            404 | 410 => return Err(PocError::unavailable("MEDIA_STATUS")),
            429 => return Err(PocError::rate_limited("MEDIA_STATUS")),
            _ => return Err(PocError::network("MEDIA_STATUS")),
        }
    }

    let response = response.ok_or_else(|| PocError::network("MEDIA_RESPONSE"))?;
    let bytes = read_media(response).await?;
    if bytes.is_empty() {
        return Err(PocError::unexpected_content("MEDIA_EMPTY"));
    }
    let (detected_type, mime_type) =
        detect_image_type(&bytes).ok_or_else(|| PocError::unexpected_content("MEDIA_SIGNATURE"))?;

    let stem = sanitize_stem(suggested_filename);
    let destination = unique_path(root, &stem, extension_for(detected_type));
    let temporary = temp_path(root);
    tokio::fs::write(&temporary, &bytes)
        .await
        .map_err(|_| PocError::save_failed("MEDIA_WRITE_TEMP"))?;
    if tokio::fs::rename(&temporary, &destination).await.is_err() {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(PocError::save_failed("MEDIA_RENAME"));
    }

    let metadata = tokio::fs::metadata(&destination)
        .await
        .map_err(|_| PocError::save_failed("MEDIA_STAT"))?;
    let exists = metadata.is_file();
    let non_empty = metadata.len() > 0 && metadata.len() == bytes.len() as u64;
    if !exists || !non_empty {
        return Err(PocError::save_failed("MEDIA_VERIFY"));
    }

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let sha256 = hex::encode(hasher.finalize());
    let file_name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("unifetch_image")
        .to_string();
    let saved_path = destination.to_string_lossy().to_string();

    Ok(SaveResult {
        file_name,
        saved_path,
        bytes: bytes.len(),
        sha256,
        detected_type,
        mime_type,
        exists,
        non_empty,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_supported_image_signatures() {
        assert_eq!(
            detect_image_type(&[0xff, 0xd8, 0xff, 0xe0]),
            Some(("jpeg", "image/jpeg"))
        );
        assert_eq!(
            detect_image_type(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            Some(("png", "image/png"))
        );
        assert_eq!(
            detect_image_type(b"GIF89a......"),
            Some(("gif", "image/gif"))
        );
        assert_eq!(
            detect_image_type(b"RIFF\x00\x00\x00\x00WEBPVP8 "),
            Some(("webp", "image/webp"))
        );
    }

    #[test]
    fn uses_the_shared_jpg_extension_for_jpeg() {
        assert_eq!(extension_for("jpeg"), "jpg");
        assert_eq!(extension_for("png"), "png");
        assert_eq!(extension_for("webp"), "webp");
        assert_eq!(extension_for("gif"), "gif");
    }

    #[test]
    fn rejects_html_and_unknown_content() {
        assert_eq!(detect_image_type(b"<!DOCTYPE html><html>"), None);
        assert_eq!(detect_image_type(b"{\"ok\":true}"), None);
        assert_eq!(detect_image_type(&[]), None);
    }

    #[test]
    fn sanitizes_untrusted_filenames() {
        assert_eq!(sanitize_stem("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_stem("..\\..\\windows\\system32\\cmd.exe"), "cmd");
        assert_eq!(
            sanitize_stem("instagram_DPCM9i1iTOx.jpg"),
            "instagram_DPCM9i1iTOx"
        );
        assert_eq!(sanitize_stem("  ...  "), "unifetch_image");
        assert_eq!(sanitize_stem("a\u{0000}b"), "a_b");
        assert!(sanitize_stem(&"a".repeat(300)).len() <= 100);
        assert!(!sanitize_stem("../../x").contains('/'));
    }

    #[test]
    fn enforces_the_media_size_cap() {
        assert!(!exceeds(0, MAX_MEDIA_BYTES, MAX_MEDIA_BYTES));
        assert!(exceeds(1, MAX_MEDIA_BYTES, MAX_MEDIA_BYTES));
        assert!(exceeds(usize::MAX, 1, MAX_MEDIA_BYTES));
    }
}
