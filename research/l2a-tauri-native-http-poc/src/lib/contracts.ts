export interface Diagnostic {
  stage: string;
  outcome: 'ok' | 'rejected' | 'error';
  status?: number;
  bytes?: number;
  elapsedMs: number;
  detail?: string;
}

export interface InstagramFetch {
  status: number;
  contentType?: string;
  body: string;
  bootstrapStatus: number;
  csrfFound: boolean;
  shortcode: string;
  kind: 'post' | 'reel';
  canonicalUrl: string;
  diagnostics: Diagnostic[];
}

export interface ThreadsFetch {
  status: number;
  contentType?: string;
  html: string;
  requestedUsername: string;
  requestedShortcode: string;
  finalUsername: string;
  finalShortcode: string;
  finalUrl: string;
  redirected: boolean;
  diagnostics: Diagnostic[];
}

export interface SaveResult {
  fileName: string;
  savedPath: string;
  bytes: number;
  sha256: string;
  detectedType: 'jpeg' | 'png' | 'gif' | 'webp';
  mimeType: string;
  exists: boolean;
  nonEmpty: boolean;
}

export interface AppInfo {
  name: string;
  version: string;
  tauriVersion: string;
  instagramOrigin: string;
  threadsOrigin: string;
  mediaHosts: string[];
  maxMediaBytes: number;
  cookieHeaderSent: boolean;
  workerUsed: boolean;
}

export interface SecurityCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface SecurityReport {
  passed: number;
  failed: number;
  checks: SecurityCheck[];
}

export interface PocErrorShape {
  code: string;
  message: string;
  stage: string;
}
