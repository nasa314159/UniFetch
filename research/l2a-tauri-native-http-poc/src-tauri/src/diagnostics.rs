use std::time::Instant;

/// Structured, sanitized stage diagnostics.
///
/// No field accepts a URL, header value, cookie, token, or body fragment. The
/// optional detail is a static audited label. This is intentionally narrower
/// than a general logging interface.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub stage: &'static str,
    pub outcome: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes: Option<usize>,
    pub elapsed_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<&'static str>,
}

pub struct StageTimer(Instant);

impl StageTimer {
    pub fn start() -> Self {
        Self(Instant::now())
    }

    pub fn elapsed_ms(&self) -> u64 {
        self.0.elapsed().as_millis().min(u64::MAX as u128) as u64
    }
}

pub fn ok(
    stage: &'static str,
    status: Option<u16>,
    bytes: Option<usize>,
    elapsed_ms: u64,
) -> Diagnostic {
    Diagnostic {
        stage,
        outcome: "ok",
        status,
        bytes,
        elapsed_ms,
        detail: None,
    }
}

pub fn ok_detail(
    stage: &'static str,
    status: Option<u16>,
    bytes: Option<usize>,
    detail: &'static str,
    elapsed_ms: u64,
) -> Diagnostic {
    Diagnostic {
        stage,
        outcome: "ok",
        status,
        bytes,
        elapsed_ms,
        detail: Some(detail),
    }
}

pub fn rejected(stage: &'static str, detail: &'static str, elapsed_ms: u64) -> Diagnostic {
    Diagnostic {
        stage,
        outcome: "rejected",
        status: None,
        bytes: None,
        elapsed_ms,
        detail: Some(detail),
    }
}

pub fn failed(
    stage: &'static str,
    status: Option<u16>,
    detail: &'static str,
    elapsed_ms: u64,
) -> Diagnostic {
    Diagnostic {
        stage,
        outcome: "error",
        status,
        bytes: None,
        elapsed_ms,
        detail: Some(detail),
    }
}
