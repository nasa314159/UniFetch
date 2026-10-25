use url::Url;

use crate::error::{PocError, PocResult};

pub const INSTAGRAM_ORIGIN: &str = "https://www.instagram.com";
pub const THREADS_ORIGIN: &str = "https://www.threads.com";
pub const MAX_SHORTCODE_LEN: usize = 64;
pub const MAX_USERNAME_LEN: usize = 64;
pub const MAX_MEDIA_BYTES: usize = 25 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstagramKind {
    Post,
    Reel,
}

impl InstagramKind {
    pub fn parse(value: &str) -> PocResult<Self> {
        match value {
            "post" => Ok(Self::Post),
            "reel" => Ok(Self::Reel),
            _ => Err(PocError::unsupported("INSTAGRAM_KIND")),
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Post => "post",
            Self::Reel => "reel",
        }
    }

    pub const fn path_segment(self) -> &'static str {
        match self {
            Self::Post => "p",
            Self::Reel => "reel",
        }
    }
}

pub fn validate_shortcode(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_SHORTCODE_LEN
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

pub fn validate_username(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_USERNAME_LEN
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'_')
}

pub fn canonical_instagram_url(kind: InstagramKind, shortcode: &str) -> PocResult<String> {
    if !validate_shortcode(shortcode) {
        return Err(PocError::invalid_url("INSTAGRAM_REF"));
    }
    Ok(format!(
        "{}/{}/{}/",
        INSTAGRAM_ORIGIN,
        kind.path_segment(),
        shortcode
    ))
}

pub fn canonical_threads_url(username: &str, shortcode: &str) -> PocResult<String> {
    if !validate_username(username) || !validate_shortcode(shortcode) {
        return Err(PocError::invalid_url("THREADS_REF"));
    }
    Ok(format!(
        "{}/@{}/post/{}/",
        THREADS_ORIGIN,
        username.to_ascii_lowercase(),
        shortcode
    ))
}

pub fn is_allowed_media_host(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    host == "cdninstagram.com"
        || host.ends_with(".cdninstagram.com")
        || host == "fbcdn.net"
        || host.ends_with(".fbcdn.net")
}

/// Defense in depth before the host allowlist. The allowlist already excludes
/// these names, but keeping the check explicit documents the SSRF boundary.
pub fn is_private_or_metadata_host(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    host == "localhost"
        || host.ends_with(".localhost")
        || host == "metadata.google.internal"
        || host == "169.254.169.254"
        || host == "127.0.0.1"
        || host == "::1"
        || host == "[::1]"
}

pub fn validate_media_url(input: &str) -> PocResult<Url> {
    let url = Url::parse(input).map_err(|_| PocError::invalid_url("MEDIA_URL"))?;
    if url.scheme() != "https" {
        return Err(PocError::invalid_url("MEDIA_URL_SCHEME"));
    }
    if !url.username().is_empty() || url.password().is_some() || url.port().is_some() {
        return Err(PocError::invalid_url("MEDIA_URL_AUTHORITY"));
    }
    if url.fragment().is_some() {
        return Err(PocError::invalid_url("MEDIA_URL_FRAGMENT"));
    }
    let host = url
        .host_str()
        .ok_or_else(|| PocError::invalid_url("MEDIA_URL_HOST"))?;
    if host.parse::<std::net::IpAddr>().is_ok() {
        return Err(PocError::invalid_url("MEDIA_URL_IP_LITERAL"));
    }
    if is_private_or_metadata_host(host) {
        return Err(PocError::invalid_url("MEDIA_URL_PRIVATE_HOST"));
    }
    if !is_allowed_media_host(host) {
        return Err(PocError::invalid_url("MEDIA_URL_HOST_NOT_ALLOWED"));
    }
    Ok(url)
}

fn threads_post_path(path: &str) -> Option<(String, String)> {
    let trimmed = path.trim_end_matches('/');
    let mut parts = trimmed.split('/');
    if !parts.next()?.is_empty() {
        return None;
    }
    let username = parts.next()?.strip_prefix('@')?;
    if parts.next()? != "post" {
        return None;
    }
    let shortcode = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    if !validate_username(username) || !validate_shortcode(shortcode) {
        return None;
    }
    Some((username.to_ascii_lowercase(), shortcode.to_string()))
}

fn is_login_path(path: &str) -> bool {
    path == "/login"
        || path.starts_with("/login/")
        || path == "/accounts"
        || path.starts_with("/accounts/")
}

/// Accepts exactly one official same-shortcode Threads redirect. A stale
/// username is allowed only when the server actually redirected and the stable
/// shortcode is unchanged. Cross-origin, login, non-post, and wrong-post
/// destinations are rejected.
pub fn validate_threads_redirect(
    requested_username: &str,
    requested_shortcode: &str,
    location: &str,
) -> PocResult<(String, String)> {
    if !validate_username(requested_username) || !validate_shortcode(requested_shortcode) {
        return Err(PocError::invalid_url("THREADS_REF"));
    }
    let url = Url::parse(location).map_err(|_| PocError::redirect_rejected("THREADS_REDIRECT"))?;
    if url.scheme() != "https"
        || url.host_str() != Some("www.threads.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err(PocError::redirect_rejected("THREADS_REDIRECT_ORIGIN"));
    }
    if is_login_path(url.path()) {
        return Err(PocError::login_required("THREADS_REDIRECT_LOGIN"));
    }
    let (username, shortcode) = threads_post_path(url.path())
        .ok_or_else(|| PocError::redirect_rejected("THREADS_REDIRECT_PATH"))?;
    if shortcode != requested_shortcode {
        return Err(PocError::unsupported("THREADS_REDIRECT_SHORTCODE"));
    }
    if username == requested_username.to_ascii_lowercase() {
        return Err(PocError::redirect_rejected("THREADS_REDIRECT_LOOP"));
    }
    Ok((username, shortcode))
}

pub fn content_length_allowed(length: Option<u64>, max: usize) -> bool {
    match length {
        Some(value) => value <= max as u64,
        None => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_valid_references() {
        assert!(validate_shortcode("DPCM9i1iTOx"));
        assert!(validate_shortcode("Ab_c-12"));
        assert!(validate_username("threads"));
        assert!(validate_username("User.Name_1"));
        assert_eq!(
            canonical_instagram_url(InstagramKind::Post, "Ab_c-12").unwrap(),
            "https://www.instagram.com/p/Ab_c-12/"
        );
        assert_eq!(
            canonical_threads_url("User.Name", "Ab_c-12").unwrap(),
            "https://www.threads.com/@user.name/post/Ab_c-12/"
        );
    }

    #[test]
    fn rejects_malformed_references() {
        for value in ["", "../x", "a/b", "a b", "a?b", "a#b", "é", &"a".repeat(65)] {
            assert!(!validate_shortcode(value), "{value:?}");
        }
        for value in ["", "../x", "a/b", "a b", "a@b", &"a".repeat(65)] {
            assert!(!validate_username(value), "{value:?}");
        }
        assert!(InstagramKind::parse("story").is_err());
    }

    #[test]
    fn accepts_only_https_allowlisted_media_hosts() {
        assert!(validate_media_url(
            "https://scontent-tpe5-1.cdninstagram.com/v/t51.82787-15/example.jpg?stp=dst-jpg"
        )
        .is_ok());
        assert!(validate_media_url("https://scontent.xx.fbcdn.net/v/example.jpg").is_ok());
        assert!(validate_media_url("https://cdninstagram.com/example.jpg").is_ok());
    }

    #[test]
    fn rejects_ssrf_and_scheme_attacks() {
        for value in [
            "http://scontent.cdninstagram.com/a.jpg",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:image/jpeg;base64,AAAA",
            "http://127.0.0.1/a.jpg",
            "http://localhost/a.jpg",
            "http://169.254.169.254/latest/meta-data/",
            "http://10.0.0.1/a.jpg",
            "http://192.168.1.1/a.jpg",
            "https://evil.example/a.jpg",
            "https://cdninstagram.com.evil.example/a.jpg",
            "https://cdninstagram.com@evil.example/a.jpg",
            "https://user:pass@scontent.cdninstagram.com/a.jpg",
            "https://scontent.cdninstagram.com:8443/a.jpg",
            "https://scontent.cdninstagram.com/a.jpg#fragment",
        ] {
            assert!(validate_media_url(value).is_err(), "{value}");
        }
    }

    #[test]
    fn accepts_only_same_shortcode_threads_alias_redirects() {
        assert_eq!(
            validate_threads_redirect(
                "old_name",
                "Ab_c-12",
                "https://www.threads.com/@new_name/post/Ab_c-12/"
            )
            .unwrap(),
            ("new_name".to_string(), "Ab_c-12".to_string())
        );
        for location in [
            "https://evil.example/@new/post/Ab_c-12/",
            "http://www.threads.com/@new/post/Ab_c-12/",
            "https://www.threads.com/@new/post/different/",
            "https://www.threads.com/login/",
            "https://www.threads.com/accounts/login/",
            "https://www.threads.com/@old_name/post/Ab_c-12/",
            "https://www.threads.com/@new/post/Ab_c-12/extra/",
            "https://user:pass@www.threads.com/@new/post/Ab_c-12/",
            "https://www.threads.com:8443/@new/post/Ab_c-12/",
        ] {
            assert!(
                validate_threads_redirect("old_name", "Ab_c-12", location).is_err(),
                "{location}"
            );
        }
    }

    #[test]
    fn enforces_content_length_cap() {
        assert!(content_length_allowed(None, MAX_MEDIA_BYTES));
        assert!(content_length_allowed(Some(10), MAX_MEDIA_BYTES));
        assert!(!content_length_allowed(
            Some(MAX_MEDIA_BYTES as u64 + 1),
            MAX_MEDIA_BYTES
        ));
    }
}
