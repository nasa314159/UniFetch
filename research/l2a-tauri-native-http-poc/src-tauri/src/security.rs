use serde::Serialize;

use crate::diagnostics::ok_detail;
use crate::error::PocError;
use crate::validate::{
    canonical_instagram_url, canonical_threads_url, content_length_allowed, validate_media_url,
    validate_shortcode, validate_threads_redirect, validate_username, InstagramKind,
    MAX_MEDIA_BYTES,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityCheck {
    pub name: &'static str,
    pub passed: bool,
    pub detail: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityReport {
    pub passed: usize,
    pub failed: usize,
    pub checks: Vec<SecurityCheck>,
}

fn check(name: &'static str, passed: bool, detail: &'static str) -> SecurityCheck {
    SecurityCheck {
        name,
        passed,
        detail,
    }
}

fn rejected_media(value: &str) -> bool {
    validate_media_url(value).is_err()
}

/// Pure, local, no-network security boundary checks. The same function backs
/// the Tauri command and the CLI self-test.
pub fn run() -> SecurityReport {
    let mut checks = Vec::new();

    for (name, value) in [
        ("media_https_only", "http://scontent.cdninstagram.com/a.jpg"),
        ("media_file_scheme", "file:///etc/passwd"),
        ("media_javascript_scheme", "javascript:alert(1)"),
        ("media_data_scheme", "data:image/jpeg;base64,AAAA"),
        ("media_loopback_ip", "http://127.0.0.1/a.jpg"),
        ("media_localhost", "http://localhost/a.jpg"),
        (
            "media_metadata_endpoint",
            "http://169.254.169.254/latest/meta-data/",
        ),
        ("media_private_10", "http://10.0.0.1/a.jpg"),
        ("media_private_192", "http://192.168.1.1/a.jpg"),
        ("media_unlisted_host", "https://evil.example/a.jpg"),
        (
            "media_lookalike_host",
            "https://cdninstagram.com.evil.example/a.jpg",
        ),
        (
            "media_userinfo",
            "https://user:pass@scontent.cdninstagram.com/a.jpg",
        ),
        (
            "media_custom_port",
            "https://scontent.cdninstagram.com:8443/a.jpg",
        ),
        (
            "media_fragment",
            "https://scontent.cdninstagram.com/a.jpg#fragment",
        ),
        (
            "media_worker_origin",
            "https://resolver.example.workers.dev/api/resolve",
        ),
        (
            "media_pages_origin",
            "https://app.example.pages.dev/api/resolve",
        ),
    ] {
        checks.push(check(name, rejected_media(value), "rejected"));
    }

    checks.push(check(
        "media_accepts_audited_cdn",
        validate_media_url(
            "https://scontent-tpe5-1.cdninstagram.com/v/t51.82787-15/example.jpg?stp=dst-jpg",
        )
        .is_ok(),
        "accepted",
    ));
    checks.push(check(
        "media_accepts_fbcdn",
        validate_media_url("https://scontent.xx.fbcdn.net/v/example.jpg").is_ok(),
        "accepted",
    ));

    for (name, value) in [
        ("shortcode_traversal", "../etc/passwd"),
        ("shortcode_whitespace", "a b"),
        (
            "shortcode_overlong",
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ),
        ("shortcode_url", "https://evil.example/p/x"),
        ("shortcode_slash", "a/b"),
        ("shortcode_query", "a?b"),
    ] {
        checks.push(check(name, !validate_shortcode(value), "rejected"));
    }
    checks.push(check(
        "shortcode_accepts_valid",
        validate_shortcode("DPCM9i1iTOx"),
        "accepted",
    ));
    checks.push(check(
        "username_rejects_traversal",
        !validate_username("../../x"),
        "rejected",
    ));
    checks.push(check(
        "username_rejects_url",
        !validate_username("https://evil.example"),
        "rejected",
    ));
    checks.push(check(
        "username_accepts_valid",
        validate_username("User.Name_1"),
        "accepted",
    ));

    for (name, location) in [
        (
            "threads_redirect_cross_origin",
            "https://evil.example/@new/post/Ab_c-12/",
        ),
        (
            "threads_redirect_http",
            "http://www.threads.com/@new/post/Ab_c-12/",
        ),
        (
            "threads_redirect_wrong_shortcode",
            "https://www.threads.com/@new/post/different/",
        ),
        (
            "threads_redirect_login",
            "https://www.threads.com/accounts/login/",
        ),
        (
            "threads_redirect_noop",
            "https://www.threads.com/@old/post/Ab_c-12/",
        ),
    ] {
        checks.push(check(
            name,
            validate_threads_redirect("old", "Ab_c-12", location).is_err(),
            "rejected",
        ));
    }
    checks.push(check(
        "threads_redirect_alias",
        validate_threads_redirect(
            "old",
            "Ab_c-12",
            "https://www.threads.com/@new/post/Ab_c-12/",
        )
        .is_ok(),
        "accepted",
    ));

    checks.push(check(
        "instagram_url_is_constructed",
        canonical_instagram_url(InstagramKind::Post, "Ab_c-12")
            .map(|value| value == "https://www.instagram.com/p/Ab_c-12/")
            .unwrap_or(false),
        "fixed_origin",
    ));
    checks.push(check(
        "threads_url_is_constructed",
        canonical_threads_url("User.Name", "Ab_c-12")
            .map(|value| value == "https://www.threads.com/@user.name/post/Ab_c-12/")
            .unwrap_or(false),
        "fixed_origin",
    ));

    checks.push(check(
        "oversized_content_length",
        !content_length_allowed(Some(MAX_MEDIA_BYTES as u64 + 1), MAX_MEDIA_BYTES),
        "rejected",
    ));
    checks.push(check(
        "bounded_content_length",
        content_length_allowed(Some(1024), MAX_MEDIA_BYTES),
        "accepted",
    ));

    let diagnostic = ok_detail("TEST", Some(200), Some(1), "not_sent", 1);
    let serialized = serde_json::to_string(&diagnostic).unwrap_or_default();
    checks.push(check(
        "diagnostics_redaction",
        !serialized.contains("http")
            && !serialized.contains('?')
            && !serialized.contains("instagram.com")
            && !serialized.contains("csrftoken"),
        "sanitized",
    ));

    let serialized_error =
        serde_json::to_string(&PocError::invalid_url("MEDIA_URL")).unwrap_or_default();
    checks.push(check(
        "error_redaction",
        !serialized_error.contains("http")
            && !serialized_error.contains('?')
            && !serialized_error.contains("instagram.com"),
        "sanitized",
    ));

    let passed = checks.iter().filter(|check| check.passed).count();
    let failed = checks.len() - passed;
    SecurityReport {
        passed,
        failed,
        checks,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_security_checks_pass() {
        let report = run();
        assert_eq!(report.failed, 0, "{:?}", report.checks);
        assert!(report.passed >= 30);
    }
}
