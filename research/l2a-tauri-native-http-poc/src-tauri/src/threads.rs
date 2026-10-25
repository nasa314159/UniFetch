use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, CONTENT_TYPE, LOCATION};
use reqwest::Client;
use serde::Serialize;
use url::Url;

use crate::diagnostics::{failed, ok, ok_detail, Diagnostic, StageTimer};
use crate::error::{PocError, PocResult};
use crate::validate::{
    canonical_threads_url, content_length_allowed, validate_shortcode, validate_threads_redirect,
    validate_username,
};

const USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MAX_HTML_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadsFetch {
    pub status: u16,
    pub content_type: Option<String>,
    pub html: String,
    pub requested_username: String,
    pub requested_shortcode: String,
    pub final_username: String,
    pub final_shortcode: String,
    pub final_url: String,
    pub redirected: bool,
    pub diagnostics: Vec<Diagnostic>,
}

fn client() -> PocResult<Client> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(20))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|_| PocError::network("THREADS_CLIENT"))
}

fn request_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        ACCEPT,
        HeaderValue::from_static(
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        ),
    );
    headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("en-US,en;q=0.9"));
    headers.insert("Sec-Fetch-Dest", HeaderValue::from_static("document"));
    headers.insert("Sec-Fetch-Mode", HeaderValue::from_static("navigate"));
    headers.insert("Sec-Fetch-Site", HeaderValue::from_static("none"));
    headers.insert("Sec-Fetch-User", HeaderValue::from_static("?1"));
    headers.insert("Upgrade-Insecure-Requests", HeaderValue::from_static("1"));
    headers
}

async fn read_bounded(mut response: reqwest::Response) -> PocResult<Vec<u8>> {
    if !content_length_allowed(response.content_length(), MAX_HTML_BYTES) {
        return Err(PocError::too_large("THREADS_BODY"));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| PocError::network("THREADS_BODY"))?
    {
        if body.len() + chunk.len() > MAX_HTML_BYTES {
            return Err(PocError::too_large("THREADS_BODY"));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn classify_status(status: u16, stage: &'static str) -> PocResult<()> {
    match status {
        200 => Ok(()),
        401 | 403 => Err(PocError::login_required(stage)),
        429 => Err(PocError::rate_limited(stage)),
        404 | 410 => Err(PocError::unavailable(stage)),
        300..=399 => Err(PocError::redirect_rejected(stage)),
        _ => Err(PocError::network(stage)),
    }
}

fn is_html(content_type: Option<&str>) -> bool {
    content_type
        .map(|value| {
            let value = value.to_ascii_lowercase();
            value.contains("text/html") || value.contains("application/xhtml+xml")
        })
        .unwrap_or(false)
}

/// One exact public Threads post. The only redirect accepted is one official
/// same-shortcode username alias. Cookies and Authorization headers are never
/// sent. Media bytes are never requested here.
pub async fn fetch(username: &str, shortcode: &str) -> PocResult<ThreadsFetch> {
    if !validate_username(username) || !validate_shortcode(shortcode) {
        return Err(PocError::invalid_url("THREADS_REF"));
    }
    let requested_username = username.to_ascii_lowercase();
    let canonical = canonical_threads_url(&requested_username, shortcode)?;
    let client = client()?;
    let mut diagnostics = Vec::new();
    let mut current = Url::parse(&canonical).map_err(|_| PocError::invalid_url("THREADS_REF"))?;

    let timer = StageTimer::start();
    let response = client
        .get(current.clone())
        .headers(request_headers())
        .send()
        .await
        .map_err(|_| PocError::network("THREADS_POST"))?;
    let mut status = response.status().as_u16();
    diagnostics.push(ok(
        "THREADS_POST_REQUEST",
        Some(status),
        None,
        timer.elapsed_ms(),
    ));
    diagnostics.push(ok(
        "THREADS_POST_RESPONSE",
        Some(status),
        None,
        timer.elapsed_ms(),
    ));
    diagnostics.push(ok_detail(
        "THREADS_COOKIE_HEADER",
        None,
        None,
        "not_sent",
        timer.elapsed_ms(),
    ));

    let mut final_username = requested_username.clone();
    let mut final_shortcode = shortcode.to_string();
    let mut final_url = canonical.clone();
    let mut redirected = false;
    let mut response = response;

    if (300..=399).contains(&status) {
        let location = response
            .headers()
            .get(LOCATION)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| PocError::redirect_rejected("THREADS_REDIRECT_MISSING"))?;
        let next = current
            .join(location)
            .map_err(|_| PocError::redirect_rejected("THREADS_REDIRECT_LOCATION"))?;
        let (alias_username, alias_shortcode) =
            validate_threads_redirect(&requested_username, shortcode, next.as_str())?;
        final_username = alias_username;
        final_shortcode = alias_shortcode.clone();
        final_url = canonical_threads_url(&final_username, &final_shortcode)?;
        current = Url::parse(&final_url).map_err(|_| PocError::invalid_url("THREADS_REDIRECT"))?;
        redirected = true;
        diagnostics.push(ok_detail(
            "THREADS_REDIRECT",
            Some(status),
            None,
            "same_shortcode_alias",
            timer.elapsed_ms(),
        ));

        let final_timer = StageTimer::start();
        response = client
            .get(current.clone())
            .headers(request_headers())
            .send()
            .await
            .map_err(|_| PocError::network("THREADS_FINAL"))?;
        status = response.status().as_u16();
        diagnostics.push(ok(
            "THREADS_FINAL_REQUEST",
            Some(status),
            None,
            final_timer.elapsed_ms(),
        ));
        diagnostics.push(ok(
            "THREADS_FINAL_RESPONSE",
            Some(status),
            None,
            final_timer.elapsed_ms(),
        ));
        if (300..=399).contains(&status) {
            diagnostics.push(failed(
                "THREADS_FINAL_CLASSIFICATION",
                Some(status),
                "multiple_redirects",
                final_timer.elapsed_ms(),
            ));
            return Err(PocError::redirect_rejected("THREADS_FINAL_REDIRECT"));
        }
    }

    if let Err(error) = classify_status(status, "THREADS_POST_STATUS") {
        diagnostics.push(failed(
            "THREADS_STATUS_CLASSIFICATION",
            Some(status),
            error.stage,
            timer.elapsed_ms(),
        ));
        return Err(error);
    }

    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    if !is_html(content_type.as_deref()) {
        return Err(PocError::unexpected_content("THREADS_CONTENT_TYPE"));
    }
    diagnostics.push(ok_detail(
        "THREADS_CONTENT_TYPE",
        Some(status),
        None,
        "html",
        timer.elapsed_ms(),
    ));

    let bytes = read_bounded(response).await?;
    let html = String::from_utf8(bytes).map_err(|_| PocError::parser_outdated("THREADS_BODY"))?;
    if html.trim().is_empty() {
        return Err(PocError::parser_outdated("THREADS_BODY_EMPTY"));
    }
    diagnostics.push(ok(
        "THREADS_BODY",
        Some(status),
        Some(html.len()),
        timer.elapsed_ms(),
    ));

    Ok(ThreadsFetch {
        status,
        content_type,
        html,
        requested_username,
        requested_shortcode: shortcode.to_string(),
        final_username,
        final_shortcode,
        final_url,
        redirected,
        diagnostics,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_html_content_types() {
        assert!(is_html(Some("text/html; charset=utf-8")));
        assert!(is_html(Some("application/xhtml+xml")));
        assert!(!is_html(Some("application/json")));
        assert!(!is_html(Some("image/jpeg")));
        assert!(!is_html(None));
    }

    #[test]
    fn classifies_threads_statuses() {
        assert!(classify_status(200, "TEST").is_ok());
        assert_eq!(
            classify_status(401, "TEST").unwrap_err().code,
            "LOGIN_REQUIRED"
        );
        assert_eq!(
            classify_status(403, "TEST").unwrap_err().code,
            "LOGIN_REQUIRED"
        );
        assert_eq!(
            classify_status(429, "TEST").unwrap_err().code,
            "RATE_LIMITED"
        );
        assert_eq!(
            classify_status(404, "TEST").unwrap_err().code,
            "CONTENT_UNAVAILABLE"
        );
        assert_eq!(
            classify_status(302, "TEST").unwrap_err().code,
            "REDIRECT_REJECTED"
        );
    }
}
