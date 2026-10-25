use std::time::Duration;

use reqwest::header::{
    HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, CONTENT_TYPE, REFERER, SET_COOKIE,
};
use reqwest::Client;
use serde::Serialize;
use url::form_urlencoded;

use crate::diagnostics::{failed, ok, ok_detail, Diagnostic, StageTimer};
use crate::error::{PocError, PocResult};
use crate::validate::{canonical_instagram_url, content_length_allowed, InstagramKind};

pub const ENDPOINT: &str = "https://www.instagram.com/graphql/query";
pub const ORIGIN: &str = "https://www.instagram.com";
const APP_ID: &str = "936619743392459";
const DOC_ID: &str = "27128499623469141";
const CSRF_COOKIE: &str = "csrftoken";
const CSRF_HEADER: &str = "X-CSRFToken";
const USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MAX_JSON_BYTES: usize = 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstagramFetch {
    pub status: u16,
    pub content_type: Option<String>,
    pub body: String,
    pub bootstrap_status: u16,
    pub csrf_found: bool,
    pub shortcode: String,
    pub kind: &'static str,
    pub canonical_url: String,
    pub diagnostics: Vec<Diagnostic>,
}

fn client() -> PocResult<Client> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(20))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|_| PocError::network("INSTAGRAM_CLIENT"))
}

fn bootstrap_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
    );
    headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("en-US,en;q=0.8"));
    headers.insert(
        REFERER,
        HeaderValue::from_static("https://www.instagram.com/"),
    );
    headers.insert("X-IG-App-ID", HeaderValue::from_static(APP_ID));
    headers
}

fn graphql_headers(csrf: &str) -> PocResult<HeaderMap> {
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("*/*"));
    headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("en-US,en;q=0.8"));
    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static("application/x-www-form-urlencoded"),
    );
    headers.insert(
        REFERER,
        HeaderValue::from_static("https://www.instagram.com/"),
    );
    headers.insert("X-IG-App-ID", HeaderValue::from_static(APP_ID));
    headers.insert(
        CSRF_HEADER,
        HeaderValue::from_str(csrf).map_err(|_| PocError::invalid_url("INSTAGRAM_CSRF"))?,
    );
    Ok(headers)
}

fn valid_csrf(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

/// Reads only the anonymous `csrftoken` value from the bootstrap response.
/// No cookie is stored or replayed. `sessionid`/`ds_user_id` are explicitly
/// ignored even if a future response contains them.
fn extract_csrf(headers: &HeaderMap) -> Option<String> {
    for value in headers.get_all(SET_COOKIE).iter() {
        let Ok(line) = value.to_str() else {
            continue;
        };
        let pair = line.split(';').next().unwrap_or("").trim();
        let Some((name, value)) = pair.split_once('=') else {
            continue;
        };
        let name = name.trim();
        let value = value.trim();
        if name == CSRF_COOKIE && valid_csrf(value) {
            return Some(value.to_string());
        }
    }
    None
}

async fn read_bounded(mut response: reqwest::Response) -> PocResult<Vec<u8>> {
    if !content_length_allowed(response.content_length(), MAX_JSON_BYTES) {
        return Err(PocError::too_large("INSTAGRAM_BODY"));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| PocError::network("INSTAGRAM_BODY"))?
    {
        if body.len() + chunk.len() > MAX_JSON_BYTES {
            return Err(PocError::too_large("INSTAGRAM_BODY"));
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

/// Performs the fixed anonymous Instagram bootstrap and one fixed-profile
/// GraphQL request. The only state carried between the two requests is the
/// ephemeral CSRF token in the `X-CSRFToken` header. A `Cookie` header is never
/// constructed or sent.
pub async fn fetch(shortcode: &str, kind: &str) -> PocResult<InstagramFetch> {
    let kind = InstagramKind::parse(kind)?;
    let canonical_url = canonical_instagram_url(kind, shortcode)?;
    let client = client()?;
    let mut diagnostics = Vec::new();

    let bootstrap_timer = StageTimer::start();
    let bootstrap = client
        .get(ORIGIN)
        .headers(bootstrap_headers())
        .send()
        .await
        .map_err(|_| PocError::network("INSTAGRAM_BOOTSTRAP"))?;
    let bootstrap_status = bootstrap.status().as_u16();
    diagnostics.push(ok(
        "INSTAGRAM_BOOTSTRAP_REQUEST",
        Some(bootstrap_status),
        None,
        bootstrap_timer.elapsed_ms(),
    ));
    diagnostics.push(ok(
        "INSTAGRAM_BOOTSTRAP_RESPONSE",
        Some(bootstrap_status),
        None,
        bootstrap_timer.elapsed_ms(),
    ));

    if let Err(error) = classify_status(bootstrap_status, "INSTAGRAM_BOOTSTRAP") {
        diagnostics.push(failed(
            "INSTAGRAM_BOOTSTRAP_CLASSIFICATION",
            Some(bootstrap_status),
            error.stage,
            bootstrap_timer.elapsed_ms(),
        ));
        return Err(error);
    }

    let csrf = extract_csrf(bootstrap.headers());
    let csrf_found = csrf.is_some();
    diagnostics.push(ok_detail(
        "INSTAGRAM_CSRF_EXTRACTION",
        Some(bootstrap_status),
        None,
        if csrf_found {
            "anonymous_csrf_present"
        } else {
            "anonymous_csrf_missing"
        },
        bootstrap_timer.elapsed_ms(),
    ));
    let Some(csrf) = csrf else {
        return Err(PocError::login_required("INSTAGRAM_CSRF"));
    };

    diagnostics.push(ok_detail(
        "INSTAGRAM_COOKIE_HEADER",
        None,
        None,
        "not_sent",
        bootstrap_timer.elapsed_ms(),
    ));

    let variables = serde_json::json!({
        "shortcode": shortcode,
        "__relay_internal__pv__PolarisAIGMMediaWebLabelEnabledrelayprovider": false
    })
    .to_string();
    let body = form_urlencoded::Serializer::new(String::new())
        .append_pair("variables", &variables)
        .append_pair("doc_id", DOC_ID)
        .append_pair("server_timestamps", "true")
        .finish();

    let graphql_timer = StageTimer::start();
    let response = client
        .post(ENDPOINT)
        .headers(graphql_headers(&csrf)?)
        .body(body)
        .send()
        .await
        .map_err(|_| PocError::network("INSTAGRAM_GRAPHQL"))?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    diagnostics.push(ok(
        "INSTAGRAM_GRAPHQL_REQUEST",
        Some(status),
        None,
        graphql_timer.elapsed_ms(),
    ));
    diagnostics.push(ok(
        "INSTAGRAM_GRAPHQL_RESPONSE",
        Some(status),
        None,
        graphql_timer.elapsed_ms(),
    ));

    if let Err(error) = classify_status(status, "INSTAGRAM_GRAPHQL") {
        diagnostics.push(failed(
            "INSTAGRAM_GRAPHQL_CLASSIFICATION",
            Some(status),
            error.stage,
            graphql_timer.elapsed_ms(),
        ));
        return Err(error);
    }

    let is_json = content_type
        .as_deref()
        .map(|value| value.to_ascii_lowercase().contains("application/json"))
        .unwrap_or(false);
    if !is_json {
        return Err(PocError::unexpected_content("INSTAGRAM_CONTENT_TYPE"));
    }

    let bytes = read_bounded(response).await?;
    let body = String::from_utf8(bytes).map_err(|_| PocError::parser_outdated("INSTAGRAM_BODY"))?;
    if !body.trim_start().starts_with('{') {
        return Err(PocError::unexpected_content("INSTAGRAM_BODY_SHAPE"));
    }
    diagnostics.push(ok(
        "INSTAGRAM_GRAPHQL_BODY",
        Some(status),
        Some(body.len()),
        graphql_timer.elapsed_ms(),
    ));

    Ok(InstagramFetch {
        status,
        content_type,
        body,
        bootstrap_status,
        csrf_found,
        shortcode: shortcode.to_string(),
        kind: kind.as_str(),
        canonical_url,
        diagnostics,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers_with(values: &[&str]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for value in values {
            headers.append(SET_COOKIE, HeaderValue::from_str(value).unwrap());
        }
        headers
    }

    #[test]
    fn extracts_only_the_anonymous_csrf_value() {
        let headers = headers_with(&[
            "csrftoken=abc_DEF-123; expires=Mon, 29-Nov-2027 05:11:44 GMT; path=/",
            "sessionid=should-not-be-used; path=/; secure",
            "mid=at2PkAAEAAEeaPYKPGIqM_W4c9SG; path=/",
            "ds_user_id=12345; path=/",
        ]);
        assert_eq!(extract_csrf(&headers).as_deref(), Some("abc_DEF-123"));
    }

    #[test]
    fn rejects_missing_or_malformed_csrf() {
        assert!(extract_csrf(&headers_with(&["mid=abc; path=/"])).is_none());
        assert!(extract_csrf(&headers_with(&["csrftoken=bad value; path=/"])).is_none());
        assert!(extract_csrf(&headers_with(&["csrftoken=; path=/"])).is_none());
        assert!(extract_csrf(&headers_with(&["csrftoken=abc.def; path=/"])).is_none());
    }

    #[test]
    fn classifies_upstream_statuses() {
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

    #[test]
    fn pins_the_production_profile_constants() {
        assert_eq!(ENDPOINT, "https://www.instagram.com/graphql/query");
        assert_eq!(APP_ID, "936619743392459");
        assert_eq!(DOC_ID, "27128499623469141");
        assert_eq!(CSRF_COOKIE, "csrftoken");
        assert_eq!(CSRF_HEADER, "X-CSRFToken");
    }
}
