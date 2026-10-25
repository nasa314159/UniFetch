<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { MediaAsset } from '@unifetch/core';
import type {
  AppInfo,
  PocErrorShape,
  SaveResult,
  SecurityReport,
} from './lib/contracts';
import {
  getAppInfo,
  resolveNative,
  runSecuritySelfCheck,
  saveNative,
  toPocError,
  type NativeResolution,
} from './lib/resolver';

const input = ref('');
const busy = ref(false);
const saving = ref(false);
const error = ref<PocErrorShape | null>(null);
const resolution = ref<NativeResolution | null>(null);
const saved = ref<SaveResult | null>(null);
const appInfo = ref<AppInfo | null>(null);
const security = ref<SecurityReport | null>(null);

const samples = [
  {
    label: 'Instagram single image',
    url: 'https://www.instagram.com/p/DPCM9i1iTOx/',
  },
  {
    label: 'Threads single image',
    url: 'https://www.threads.com/@threads/post/DNgrJ8UyTAF/',
  },
];

function useSample(url: string): void {
  input.value = url;
  error.value = null;
}

async function resolve(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = null;
  resolution.value = null;
  saved.value = null;
  try {
    resolution.value = await resolveNative(input.value);
  } catch (cause) {
    error.value = toPocError(cause);
  } finally {
    busy.value = false;
  }
}

async function save(asset: MediaAsset): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  error.value = null;
  saved.value = null;
  try {
    saved.value = await saveNative(asset);
  } catch (cause) {
    error.value = toPocError(cause);
  } finally {
    saving.value = false;
  }
}

async function runSecurity(): Promise<void> {
  try {
    security.value = await runSecuritySelfCheck();
  } catch (cause) {
    error.value = toPocError(cause);
  }
}

onMounted(async () => {
  try {
    appInfo.value = await getAppInfo();
  } catch (cause) {
    error.value = toPocError(cause);
  }
  await runSecurity();
});
</script>

<template>
  <main class="shell">
    <header class="masthead">
      <div>
        <p class="eyebrow">L2A · isolated proof of concept</p>
        <h1>Native HTTP local resolver</h1>
        <p class="lede">
          Device-local Instagram and Threads metadata acquisition, shared
          UniFetch parsing, and an application-controlled image save. No
          Cloudflare Worker is contacted.
        </p>
      </div>
      <span class="badge">Tauri v2 · Rust</span>
    </header>

    <section class="card">
      <label class="field-label" for="url">Public post URL</label>
      <div class="row">
        <input
          id="url"
          v-model="input"
          type="url"
          autocomplete="off"
          spellcheck="false"
          placeholder="https://www.instagram.com/p/… or https://www.threads.com/@…/post/…"
          @keydown.enter.prevent="resolve"
        />
        <button
          class="primary"
          :disabled="busy || !input.trim()"
          @click="resolve"
        >
          {{ busy ? 'Resolving…' : 'Resolve locally' }}
        </button>
      </div>
      <div class="samples">
        <span>Manual samples:</span>
        <button
          v-for="sample in samples"
          :key="sample.url"
          class="link-button"
          type="button"
          @click="useSample(sample.url)"
        >
          {{ sample.label }}
        </button>
      </div>
      <p class="hint">
        One exact public single-image post per action. Carousels, video, GIF,
        stories, profiles, login, and authenticated content are out of scope.
      </p>
    </section>

    <section v-if="error" class="card error" role="alert">
      <div class="section-title">
        <h2>{{ error.code }}</h2>
        <span class="stage">{{ error.stage }}</span>
      </div>
      <p>{{ error.message }}</p>
      <p class="hint">
        Failed closed. No alternate post, guessed identifier, proxy, retry loop,
        or cookie fallback was attempted.
      </p>
    </section>

    <section v-if="resolution" class="card">
      <div class="section-title">
        <h2>Resolved metadata</h2>
        <span class="badge subtle">{{ resolution.source }}</span>
      </div>
      <dl class="meta-grid">
        <dt>Platform</dt>
        <dd>{{ resolution.result.post.platform }}</dd>
        <dt>Kind</dt>
        <dd>{{ resolution.kind }}</dd>
        <dt>Canonical URL</dt>
        <dd class="break">{{ resolution.result.post.canonicalUrl }}</dd>
        <dt>Author</dt>
        <dd>
          {{ resolution.result.post.author?.username ?? 'not supplied' }}
          <span v-if="resolution.result.post.author?.displayName">
            · {{ resolution.result.post.author.displayName }}
          </span>
        </dd>
        <dt>Caption</dt>
        <dd class="caption">
          {{ resolution.result.post.caption ?? 'No caption in response.' }}
        </dd>
        <dt>Assets</dt>
        <dd>{{ resolution.result.post.assets.length }}</dd>
        <dt>Worker</dt>
        <dd>not contacted</dd>
        <dt>Credentials</dt>
        <dd>none exported</dd>
      </dl>

      <div class="asset-list">
        <article
          v-for="asset in resolution.result.post.assets"
          :key="asset.id"
          class="asset"
        >
          <div>
            <strong>{{ asset.suggestedFilename }}</strong>
            <p class="hint">
              {{ asset.type }}
              <span v-if="asset.width && asset.height">
                · {{ asset.width }}×{{ asset.height }}
              </span>
              <span v-if="asset.mimeType"> · {{ asset.mimeType }}</span>
            </p>
          </div>
          <button
            class="primary"
            :disabled="saving || asset.type !== 'image'"
            @click="save(asset)"
          >
            {{ saving ? 'Saving…' : 'Save image' }}
          </button>
        </article>
      </div>

      <p class="hint">
        The signed media URL is passed only to the native save command and is
        never rendered, logged, or included in diagnostics.
      </p>
    </section>

    <section v-if="saved" class="card saved">
      <div class="section-title">
        <h2>Saved file evidence</h2>
        <span class="badge subtle">{{ saved.detectedType }}</span>
      </div>
      <dl class="meta-grid">
        <dt>File</dt>
        <dd class="break">{{ saved.fileName }}</dd>
        <dt>Bytes</dt>
        <dd>{{ saved.bytes.toLocaleString() }}</dd>
        <dt>Signature</dt>
        <dd>{{ saved.detectedType }} · {{ saved.mimeType }}</dd>
        <dt>Exists / nonempty</dt>
        <dd>{{ saved.exists }} / {{ saved.nonEmpty }}</dd>
        <dt>SHA-256</dt>
        <dd class="break mono">{{ saved.sha256 }}</dd>
        <dt>Location</dt>
        <dd class="break mono">{{ saved.savedPath }}</dd>
      </dl>
    </section>

    <section v-if="resolution" class="card">
      <div class="section-title">
        <h2>Request diagnostics</h2>
        <span class="badge subtle">sanitized</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Stage</th>
              <th>Outcome</th>
              <th>Status</th>
              <th>Bytes</th>
              <th>ms</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in resolution.diagnostics"
              :key="`${item.stage}-${item.elapsedMs}`"
            >
              <td class="mono">{{ item.stage }}</td>
              <td>{{ item.outcome }}</td>
              <td>{{ item.status ?? '—' }}</td>
              <td>{{ item.bytes ?? '—' }}</td>
              <td>{{ item.elapsedMs }}</td>
              <td>{{ item.detail ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="hint">
        Diagnostics contain stage names, statuses, byte counts, timings, and
        static labels only. They never contain URLs, query strings, headers,
        cookies, tokens, or response bodies.
      </p>
    </section>

    <section v-if="security" class="card">
      <div class="section-title">
        <h2>Security boundary self-check</h2>
        <span class="badge" :class="security.failed === 0 ? 'ok' : 'bad'">
          {{ security.passed }} passed · {{ security.failed }} failed
        </span>
      </div>
      <details>
        <summary>Show local negative tests</summary>
        <ul class="checks">
          <li v-for="check in security.checks" :key="check.name">
            <span :class="check.passed ? 'tick' : 'cross'">
              {{ check.passed ? 'PASS' : 'FAIL' }}
            </span>
            <span class="mono">{{ check.name }}</span>
            <span class="hint">{{ check.detail }}</span>
          </li>
        </ul>
      </details>
    </section>

    <footer class="footer">
      <div v-if="appInfo">
        <span>{{ appInfo.name }}</span>
        <span>app {{ appInfo.version }}</span>
        <span>Tauri {{ appInfo.tauriVersion }}</span>
        <span
          >max media
          {{ Math.round(appInfo.maxMediaBytes / 1024 / 1024) }} MiB</span
        >
        <span
          >Cookie header:
          {{ appInfo.cookieHeaderSent ? 'sent' : 'never' }}</span
        >
        <span>Worker: {{ appInfo.workerUsed ? 'used' : 'not used' }}</span>
      </div>
      <p>
        Experimental research branch. Not a product. No gallery/MediaStore
        export, login, share intent, background download, iOS build, or Worker
        change is included.
      </p>
    </footer>
  </main>
</template>
