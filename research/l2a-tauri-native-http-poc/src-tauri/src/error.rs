use std::fmt;

/// A deliberately static error type.
///
/// Every field is a `&'static str` so a command, validator, or transport error
/// can never accidentally include a raw signed media URL, cookie, token, header
/// value, or upstream body fragment. Stage names and messages are audited here.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PocError {
    pub code: &'static str,
    pub message: &'static str,
    pub stage: &'static str,
}

impl PocError {
    pub const fn new(code: &'static str, message: &'static str, stage: &'static str) -> Self {
        Self {
            code,
            message,
            stage,
        }
    }

    pub const fn invalid_url(stage: &'static str) -> Self {
        Self::new(
            "INVALID_URL",
            "The supplied content reference is not valid.",
            stage,
        )
    }

    pub const fn unsupported(stage: &'static str) -> Self {
        Self::new(
            "UNSUPPORTED_CONTENT",
            "Only one exact public single-image post is supported by this PoC.",
            stage,
        )
    }

    pub const fn login_required(stage: &'static str) -> Self {
        Self::new(
            "LOGIN_REQUIRED",
            "The upstream service requires authentication or presented a challenge.",
            stage,
        )
    }

    pub const fn rate_limited(stage: &'static str) -> Self {
        Self::new(
            "RATE_LIMITED",
            "The upstream service temporarily limited this request.",
            stage,
        )
    }

    pub const fn unavailable(stage: &'static str) -> Self {
        Self::new(
            "CONTENT_UNAVAILABLE",
            "The requested public content is unavailable.",
            stage,
        )
    }

    pub const fn network(stage: &'static str) -> Self {
        Self::new(
            "NETWORK_ERROR",
            "The native request could not be completed.",
            stage,
        )
    }

    pub const fn redirect_rejected(stage: &'static str) -> Self {
        Self::new(
            "REDIRECT_REJECTED",
            "The upstream redirect was outside the audited allowlist.",
            stage,
        )
    }

    pub const fn too_large(stage: &'static str) -> Self {
        Self::new(
            "RESPONSE_TOO_LARGE",
            "The upstream response exceeded the supported size.",
            stage,
        )
    }

    pub const fn unexpected_content(stage: &'static str) -> Self {
        Self::new(
            "UNEXPECTED_CONTENT",
            "The upstream response did not have the expected content type.",
            stage,
        )
    }

    pub const fn parser_outdated(stage: &'static str) -> Self {
        Self::new(
            "PARSER_OUTDATED",
            "The upstream response was not recognized by the pinned profile.",
            stage,
        )
    }

    pub const fn save_failed(stage: &'static str) -> Self {
        Self::new(
            "SAVE_FAILED",
            "The media file could not be saved or verified.",
            stage,
        )
    }

    pub const fn unknown(stage: &'static str) -> Self {
        Self::new("UNKNOWN", "An unexpected local error occurred.", stage)
    }
}

impl fmt::Display for PocError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{}: {} ({})",
            self.code, self.message, self.stage
        )
    }
}

impl std::error::Error for PocError {}

pub type PocResult<T> = Result<T, PocError>;
