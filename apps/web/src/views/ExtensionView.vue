<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  EXTENSION_RELEASE,
  formatReleaseSize,
  hasVerifiedRelease,
} from '../config/extension-release';

const releaseAvailable = computed(() => hasVerifiedRelease());
const copyStatus = ref('');

async function copySettingsUrl() {
  try {
    await navigator.clipboard.writeText('chrome://extensions');
    copyStatus.value = 'Copied chrome://extensions';
  } catch {
    copyStatus.value =
      'Copy failed. Select chrome://extensions in the address bar manually.';
  }
}
</script>

<template>
  <article class="extension-page">
    <header class="extension-hero">
      <RouterLink class="back-link" to="/">← Back to UniFetch</RouterLink>
      <p class="eyebrow">DESKTOP CHROMIUM · MANUAL INSTALL</p>
      <h1>Install Browser Extension</h1>
      <p class="lead">
        Add authenticated Instagram downloads to desktop Chrome / Chromium. The
        extension is distributed as a GitHub Releases ZIP and loaded manually
        with <strong>Load unpacked</strong>.
      </p>
      <p class="not-store">
        Not listed in the Chrome Web Store. Developer mode is required for this
        installation method.
      </p>
      <dl class="release-facts">
        <div>
          <dt>Version</dt>
          <dd>v{{ EXTENSION_RELEASE.version }}</dd>
        </div>
        <div>
          <dt>Channel</dt>
          <dd>GitHub Releases</dd>
        </div>
        <div>
          <dt>Install</dt>
          <dd>Manual · Load unpacked</dd>
        </div>
        <div>
          <dt>Browser</dt>
          <dd>
            Desktop Chrome / Chromium {{ EXTENSION_RELEASE.minChromeVersion }}+
          </dd>
        </div>
      </dl>
    </header>

    <section class="mode-grid" aria-labelledby="mode-title">
      <h2 id="mode-title" class="visually-plain">Choose the right UniFetch</h2>
      <article class="mode web-mode">
        <p class="mode-label">NO INSTALL REQUIRED</p>
        <h3>UniFetch Web/PWA</h3>
        <p>
          For public Instagram links in a normal browser tab. Works on desktop
          and mobile, including the PWA share flow.
        </p>
        <ul>
          <li>Public Post, Carousel and Reel metadata</li>
          <li>No Instagram login required</li>
          <li>Stories are not available</li>
        </ul>
        <RouterLink to="/">Use the Web/PWA</RouterLink>
      </article>
      <article class="mode extension-mode">
        <p class="mode-label">DESKTOP CHROMIUM</p>
        <h3>UniFetch Browser Extension</h3>
        <p>
          For downloads that need your existing Instagram browser session.
          Installed manually from a GitHub Releases ZIP.
        </p>
        <ul>
          <li>Authenticated Post, Carousel and Reel downloads</li>
          <li>
            Stories only when the link already contains an explicit Story ID
          </li>
          <li>Uses the Instagram session already in your browser</li>
        </ul>
      </article>
    </section>

    <aside class="mobile-note" role="note">
      <strong>This installation flow is for desktop browsers.</strong>
      <p>
        Mobile Chrome, Safari for iOS and Android browsers cannot load unpacked
        Chromium extensions. Use the UniFetch Web/PWA on your phone for public
        Post, Carousel and Reel links and the existing share workflow.
      </p>
      <RouterLink to="/">Open the UniFetch Web/PWA</RouterLink>
    </aside>

    <div class="desktop-flow">
      <section class="download-card" aria-labelledby="download-title">
        <div class="download-heading">
          <div>
            <p class="mode-label">GITHUB RELEASE</p>
            <h2 id="download-title">Download for Chrome / Chromium</h2>
          </div>
          <span class="version-badge">v{{ EXTENSION_RELEASE.version }}</span>
        </div>

        <p>
          Downloading the ZIP does not install the extension by itself. Follow
          the installation steps below.
        </p>

        <template v-if="releaseAvailable">
          <p>
            Download the versioned ZIP, then extract it to a permanent folder
            before loading it.
          </p>
          <a
            class="download-action"
            :href="EXTENSION_RELEASE.downloadUrl ?? undefined"
            download
          >
            Download ZIP <span aria-hidden="true">↓</span>
          </a>
          <dl class="artifact-meta">
            <div>
              <dt>File</dt>
              <dd>
                <code>{{ EXTENSION_RELEASE.fileName }}</code>
              </dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{{ formatReleaseSize(EXTENSION_RELEASE.sizeBytes) }}</dd>
            </div>
            <div>
              <dt>SHA-256</dt>
              <dd>
                <code class="checksum">{{ EXTENSION_RELEASE.sha256 }}</code>
              </dd>
            </div>
          </dl>
          <p class="verify-note">
            After downloading, compare the file’s SHA-256 with the value above.
            Only install packages published on the official UniFetch GitHub
            Releases page.
          </p>
        </template>

        <div v-else class="release-unavailable" role="status">
          <strong>Release not yet available</strong>
          <p>
            There is no verified extension ZIP published for this version yet.
            The download button stays disabled rather than pointing at a missing
            file.
          </p>
          <a :href="EXTENSION_RELEASE.releasesUrl"
            >Check the GitHub Releases page</a
          >
        </div>

        <a class="releases-link" :href="EXTENSION_RELEASE.releasesUrl"
          >All UniFetch GitHub Releases <span aria-hidden="true">↗</span></a
        >
      </section>

      <section class="guide" aria-labelledby="steps-title">
        <p class="mode-label">STEP BY STEP</p>
        <h2 id="steps-title">Install the unpacked extension</h2>
        <p class="guide-intro">
          This takes a few minutes. You do not need Git, Node.js, pnpm or any
          development tools.
        </p>

        <ol class="steps">
          <li>
            <h3>Download the ZIP</h3>
            <p>
              Use the download button above and keep the file name
              <code>{{ EXTENSION_RELEASE.fileName }}</code
              >.
            </p>
          </li>
          <li>
            <h3>Extract it to a permanent folder</h3>
            <p>
              For example <code>Documents/UniFetch Extension</code>. Keep this
              folder: Chromium loads the extension from it every time the
              browser starts. Do not run it from Downloads or delete it after
              installation.
            </p>
            <p>
              The extracted
              <code
                >unifetch-chromium-extension-v{{
                  EXTENSION_RELEASE.version
                }}</code
              >
              folder must directly contain <code>manifest.json</code>.
            </p>
          </li>
          <li>
            <h3>Open <code>chrome://extensions</code></h3>
            <p>
              Paste <code>chrome://extensions</code> into the address bar, or
              open the browser menu → Extensions → Manage Extensions.
            </p>
            <div class="copy-row">
              <button
                type="button"
                class="copy-button"
                @click="copySettingsUrl"
              >
                Copy <code>chrome://extensions</code>
              </button>
              <span class="copy-status" role="status" aria-live="polite">{{
                copyStatus
              }}</span>
            </div>
          </li>
          <li>
            <h3>Enable Developer mode</h3>
            <p>
              Turn on the <strong>Developer mode</strong> toggle in the
              extensions page, usually in the top-right corner.
            </p>
          </li>
          <li>
            <h3>Click “Load unpacked”</h3>
            <p>
              The button appears after Developer mode is enabled. Choose
              <strong>Load unpacked</strong>.
            </p>
          </li>
          <li>
            <h3>Select the folder containing manifest.json</h3>
            <p>
              Select the extracted
              <code
                >unifetch-chromium-extension-v{{
                  EXTENSION_RELEASE.version
                }}</code
              >
              folder itself, not its parent or the ZIP file. If the browser says
              <code>manifest.json</code> is missing, select the folder that
              directly contains it.
            </p>
          </li>
          <li>
            <h3>Open Instagram and sign in normally</h3>
            <p>
              Open <code>instagram.com</code> in the same browser profile and
              sign in as usual. Click the UniFetch Instagram icon in the
              toolbar; if it is hidden, open the extensions (puzzle-piece) menu
              and pin it.
            </p>
            <p>
              Open a Post, Carousel, Reel or an explicit-ID Story tab, then use
              Resolve or Download all in the popup. Nothing is sent to a
              UniFetch server.
            </p>
          </li>
        </ol>
      </section>

      <section class="notes-grid" aria-label="Updates, security and help">
        <article>
          <h2>Updates are manual</h2>
          <p>
            Chrome Web Store updates do not apply. To update, download the newer
            GitHub release, extract it, then return to
            <code>chrome://extensions</code> and click
            <strong>Reload</strong> on UniFetch Instagram. If the folder path
            changes, remove the old extension and load the new folder.
          </p>
          <p>
            To uninstall, click <strong>Remove</strong> in
            <code>chrome://extensions</code>, then delete the extracted folder.
          </p>
        </article>
        <article>
          <h2>Security and privacy</h2>
          <p>
            The extension requests only <code>activeTab</code>,
            <code>scripting</code> and <code>clipboardRead</code>, with access
            limited to <code>https://www.instagram.com/*</code>. It does not
            request cookies, history, tabs, webRequest or storage.
          </p>
          <p>
            It does not read or export cookies, does not use a UniFetch media
            proxy and sends no telemetry. Installing it does not grant access to
            content you cannot already view.
          </p>
          <p>
            Chrome may show security prompts. Do not disable browser security
            features or bypass warnings. Only load this extension from the
            official UniFetch GitHub Releases page.
          </p>
        </article>
        <article>
          <h2>Troubleshooting</h2>
          <ul>
            <li>
              <strong>“Manifest file is missing or unreadable”</strong>: select
              the folder that directly contains <code>manifest.json</code>, not
              its parent.
            </li>
            <li>
              <strong>No toolbar icon</strong>: open the extensions menu and pin
              UniFetch Instagram.
            </li>
            <li>
              <strong>“Extension reload required”</strong>: reload or rebuild
              the extension after a manual update.
            </li>
            <li>
              <strong>Unsupported Story</strong>: only
              <code>/stories/&lt;username&gt;/&lt;id&gt;/</code> links with an
              explicit media ID are accepted.
            </li>
          </ul>
        </article>
      </section>

      <section class="help-links" aria-labelledby="help-title">
        <h2 id="help-title">Official references</h2>
        <ul>
          <li>
            <a
              :href="EXTENSION_RELEASE.installHelpUrl"
              target="_blank"
              rel="noopener noreferrer"
              >Chrome documentation: load an unpacked extension
              <span aria-hidden="true">↗</span></a
            >
          </li>
          <li>
            <a
              :href="EXTENSION_RELEASE.releasesUrl"
              target="_blank"
              rel="noopener noreferrer"
              >UniFetch GitHub Releases <span aria-hidden="true">↗</span></a
            >
          </li>
          <li>
            <a
              :href="EXTENSION_RELEASE.repositoryUrl"
              target="_blank"
              rel="noopener noreferrer"
              >UniFetch source code and issue tracker
              <span aria-hidden="true">↗</span></a
            >
          </li>
        </ul>
        <p>
          Supported content is limited to authenticated Instagram Post, Carousel
          and Reel downloads, plus Stories with an explicit Story ID.
          Username-only Stories, Highlights and Story enumeration are not
          supported and fail closed. See the
          <RouterLink to="/">Web/PWA</RouterLink> for public-link downloads.
        </p>
      </section>
    </div>
  </article>
</template>

<style scoped>
.extension-page {
  /* Keep the shared palette but meet AA contrast for the longer guide copy. */
  --muted: #626d5f;
  max-width: 900px;
  margin: auto;
}
.extension-hero {
  text-align: center;
  padding: 36px 0 30px;
}
.back-link {
  display: inline-block;
  margin-bottom: 22px;
  color: var(--muted);
  font-size: 12px;
  text-decoration: none;
}
.back-link:hover {
  color: var(--green);
}
.eyebrow,
.mode-label {
  font-size: 10px;
  letter-spacing: 1.9px;
  font-weight: 650;
  color: var(--green);
  margin: 0;
}
h1 {
  font-size: clamp(34px, 5vw, 52px);
  letter-spacing: -2.2px;
  line-height: 1.12;
  font-weight: 650;
  margin: 15px 0 14px;
}
.lead {
  max-width: 640px;
  margin: 0 auto;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.75;
}
.not-store {
  display: inline-block;
  margin: 16px 0 0;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #f8f9f5;
  color: #65705f;
  font-size: 11px;
}
.release-facts {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px 26px;
  margin: 25px 0 0;
  padding: 17px 18px;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: white;
}
.release-facts div {
  text-align: left;
}
.release-facts dt {
  font-size: 9px;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--muted);
}
.release-facts dd {
  margin: 4px 0 0;
  font-size: 12px;
  font-weight: 600;
}
.mode-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin: 30px 0 0;
}
.mode {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 21px;
  background: #f8f9f5;
}
.extension-mode {
  background: white;
  border-color: #cfdbcc;
  box-shadow: 0 8px 28px #273e2c08;
}
.mode h3 {
  font-size: 16px;
  margin: 8px 0 8px;
  letter-spacing: -0.3px;
}
.mode p:not(.mode-label) {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.75;
}
.mode ul {
  margin: 14px 0 15px;
  padding: 0 0 0 17px;
  color: #556052;
  font-size: 12px;
  line-height: 1.8;
}
.mode a {
  color: var(--green);
  font-size: 12px;
  font-weight: 600;
}
.mobile-note {
  display: none;
  margin-top: 18px;
  padding: 18px;
  border: 1px solid #e7dcc4;
  border-radius: 11px;
  background: #fffaf0;
  font-size: 12px;
  line-height: 1.7;
}
.mobile-note p {
  color: #76664a;
  margin: 7px 0 10px;
}
.mobile-note a {
  color: var(--green);
  font-weight: 600;
}
.download-card,
.guide,
.notes-grid article,
.help-links {
  border: 1px solid var(--border);
  border-radius: 13px;
  background: white;
}
.download-card {
  margin-top: 16px;
  padding: 24px;
}
.download-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.download-heading h2,
.guide h2,
.notes-grid h2,
.help-links h2 {
  font-size: 18px;
  letter-spacing: -0.4px;
  margin: 7px 0 0;
}
.version-badge {
  padding: 6px 9px;
  border-radius: 5px;
  background: var(--soft);
  color: var(--green);
  font-size: 10px;
  font-weight: 650;
  white-space: nowrap;
}
.download-card > p {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.75;
  margin: 13px 0 0;
}
.download-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-top: 17px;
  padding: 14px 21px;
  border: 1px solid #365c43;
  border-radius: 9px;
  background: #365c43;
  color: white;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}
.download-action:hover {
  filter: brightness(0.96);
}
.artifact-meta {
  display: grid;
  gap: 9px;
  margin: 18px 0 0;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
.artifact-meta div {
  display: grid;
  grid-template-columns: 64px 1fr;
  gap: 10px;
}
.artifact-meta dt {
  font-size: 10px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 1px;
  padding-top: 2px;
}
.artifact-meta dd {
  margin: 0;
  font-size: 11px;
  min-width: 0;
}
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.94em;
  overflow-wrap: anywhere;
}
.checksum {
  color: #556052;
}
.verify-note {
  font-size: 11px !important;
}
.release-unavailable {
  margin-top: 16px;
  padding: 16px;
  border: 1px solid #e7dcc4;
  border-radius: 9px;
  background: #fffaf0;
  font-size: 12px;
  line-height: 1.7;
}
.release-unavailable p {
  color: #76664a;
  margin: 6px 0 9px;
}
.release-unavailable a,
.releases-link {
  color: var(--green);
  font-size: 11px;
  font-weight: 600;
}
.releases-link {
  display: inline-block;
  margin-top: 16px;
}
.guide {
  margin-top: 13px;
  padding: 24px;
}
.guide-intro {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}
.steps {
  list-style: none;
  counter-reset: step;
  margin: 21px 0 0;
  padding: 0;
}
.steps li {
  position: relative;
  counter-increment: step;
  padding: 0 0 21px 45px;
}
.steps li:last-child {
  padding-bottom: 0;
}
.steps li::before {
  content: counter(step);
  position: absolute;
  left: 0;
  top: 0;
  width: 27px;
  height: 27px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #edf1e8;
  color: var(--green);
  font-size: 11px;
  font-weight: 700;
}
.steps li::after {
  content: '';
  position: absolute;
  left: 13px;
  top: 31px;
  bottom: 8px;
  width: 1px;
  background: var(--border);
}
.steps li:last-child::after {
  display: none;
}
.steps h3 {
  font-size: 13px;
  margin: 3px 0 5px;
}
.steps p {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.75;
  margin: 0 0 5px;
}
.copy-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 9px;
}
.copy-button {
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #f8f9f5;
  color: var(--green);
  padding: 7px 10px;
  font-size: 11px;
}
.copy-status {
  color: var(--muted);
  font-size: 10px;
}
.notes-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 13px;
}
.notes-grid article {
  padding: 21px;
}
.notes-grid article:last-child {
  grid-column: 1 / -1;
}
.notes-grid h2 {
  font-size: 14px;
  margin: 0 0 9px;
}
.notes-grid p,
.notes-grid li {
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.8;
}
.notes-grid p {
  margin: 0 0 9px;
}
.notes-grid ul {
  margin: 0;
  padding-left: 17px;
}
.notes-grid li {
  margin-bottom: 6px;
}
.help-links {
  margin-top: 13px;
  padding: 21px;
}
.help-links h2 {
  font-size: 14px;
  margin: 0 0 9px;
}
.help-links ul {
  margin: 0;
  padding-left: 17px;
  font-size: 12px;
  line-height: 1.9;
}
.help-links li {
  padding: 3px 0;
}
.help-links a {
  display: inline-block;
  padding: 2px 0;
  color: var(--green);
}
.help-links p {
  color: var(--muted);
  font-size: 11.5px;
  line-height: 1.8;
  margin: 13px 0 0;
}
.help-links p a {
  font-weight: 600;
}
.visually-plain {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
@media (max-width: 760px) {
  .extension-hero {
    padding-top: 24px;
  }
  .mode-grid,
  .notes-grid {
    grid-template-columns: 1fr;
  }
  .notes-grid article:last-child {
    grid-column: auto;
  }
  .desktop-flow {
    display: none;
  }
  .mobile-note {
    display: block;
  }
  .release-facts {
    text-align: left;
  }
  .release-facts div {
    width: calc(50% - 14px);
  }
}
</style>
