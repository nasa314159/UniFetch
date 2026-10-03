<script setup lang="ts">
import { computed, ref } from 'vue';
import { asUniFetchError } from '@unifetch/core';
import type { InstagramResolutionResult } from '@unifetch/meta-resolver';
import { downloadSequential, originalMediaUrl } from '@unifetch/downloader';
import { WebRuntime } from '@unifetch/runtime-web';
const props = defineProps<{ result: InstagramResolutionResult }>();
const selected = ref(props.result.post.assets.map((asset) => asset.id));
const downloading = ref(false);
const notice = ref('');
function originalLink(input: string): string | undefined {
  try {
    return originalMediaUrl(input);
  } catch {
    return undefined;
  }
}
const contentType = computed(() =>
  props.result.kind === 'carousel'
    ? 'Carousel'
    : props.result.kind === 'video' &&
        props.result.post.canonicalUrl.includes('/reel/')
      ? 'Reel'
      : 'Post',
);
async function download(ids: string[]) {
  downloading.value = true;
  notice.value = '';
  try {
    await downloadSequential(
      props.result.post.assets.filter((asset) => ids.includes(asset.id)),
      new WebRuntime(),
    );
    notice.value =
      'Download requested. Check your browser for the saved file. Multiple files may require permission.';
  } catch (cause) {
    const error = asUniFetchError(cause);
    notice.value = `${error.message} (${error.code})`;
  } finally {
    downloading.value = false;
  }
}
</script>
<template>
  <section class="result-card" aria-label="Resolved media">
    <div class="result-heading">
      <span class="resolved-label"
        ><span aria-hidden="true">✓</span> Ready to save</span
      ><span class="type-label">Instagram · {{ contentType }}</span>
    </div>
    <p class="source-label">
      Resolution source:
      {{
        result.source === 'fixture'
          ? 'Demo fixture'
          : result.source === 'worker'
            ? 'UniFetch Resolver'
            : 'Live Instagram'
      }}
    </p>
    <div v-if="result.post.author" class="author">
      <div class="avatar" aria-hidden="true">U</div>
      <div>
        <strong>{{
          result.post.author.displayName || result.post.author.username
        }}</strong
        ><span v-if="result.post.author.username"
          >@{{ result.post.author.username
          }}<template v-if="result.source === 'fixture'">
            · Fictional demo</template
          ></span
        >
      </div>
    </div>
    <p v-if="result.post.caption" class="caption">{{ result.post.caption }}</p>
    <div
      class="media-grid"
      :class="{ single: result.post.assets.length === 1 }"
    >
      <article
        v-for="(asset, index) in result.post.assets"
        :key="asset.id"
        class="media-item"
      >
        <div class="preview">
          <img
            v-if="asset.type === 'image'"
            :src="asset.url"
            :alt="`${result.source === 'fixture' ? 'Original demo artwork' : 'Instagram image'} ${index + 1}`"
            loading="lazy"
          /><video
            v-else-if="asset.type === 'video'"
            :src="asset.url"
            :poster="asset.thumbnailUrl"
            controls
            playsinline
            preload="none"
            :aria-label="`${result.source === 'fixture' ? 'Demo video' : 'Instagram video'} ${index + 1}`"
          ></video
          ><audio v-else :src="asset.url" controls preload="none"></audio>
        </div>
        <div class="asset-details">
          <label v-if="result.post.assets.length > 1" class="selection"
            ><input v-model="selected" type="checkbox" :value="asset.id" /><span
              >Asset {{ index + 1 }}</span
            ></label
          ><strong v-else>{{
            asset.type === 'image' ? 'Original image' : 'Original video'
          }}</strong
          ><span
            >{{
              asset.width && asset.height
                ? `${asset.width} × ${asset.height}`
                : ''
            }}{{
              asset.durationMs ? ` · ${asset.durationMs / 1000}s` : ''
            }}</span
          ><small>{{ asset.mimeType || asset.type }}</small>
          <a
            v-if="result.source !== 'fixture' && originalLink(asset.url)"
            :href="originalLink(asset.url)"
            target="_blank"
            rel="noopener noreferrer"
            referrerpolicy="no-referrer"
            >Open original<span v-if="result.post.assets.length > 1">
              · Asset {{ index + 1 }}</span
            ></a
          >
        </div>
      </article>
    </div>
    <div class="download-actions">
      <template v-if="result.post.assets.length > 1"
        ><button
          class="primary"
          :disabled="downloading || selected.length === 0"
          @click="download(selected)"
        >
          {{
            downloading
              ? 'Requesting downloads…'
              : `Download selected (${selected.length})`
          }}
          <span aria-hidden="true">↓</span></button
        ><button
          class="secondary"
          :disabled="downloading"
          @click="download(result.post.assets.map((a) => a.id))"
        >
          Download all
        </button></template
      ><button
        v-else
        class="primary"
        :disabled="downloading"
        @click="download(result.post.assets.map((a) => a.id))"
      >
        {{ downloading ? 'Requesting download…' : 'Download' }}
        <span aria-hidden="true">↓</span>
      </button>
    </div>
    <p v-if="result.source !== 'fixture'" class="download-notice">
      Download reads the source directly when its cross-origin rules allow it.
      Open original opens the source file without claiming it was saved.
      UniFetch does not relay media.
    </p>
    <p v-if="notice" class="download-notice" role="status">{{ notice }}</p>
    <details class="privacy">
      <summary>Privacy <span>Resolution details</span></summary>
      <div v-if="result.source === 'worker'" class="worker-privacy">
        <strong>Resolution</strong>
        <ul>
          <li>✓ User initiated</li>
          <li>○ Metadata resolved by UniFetch Resolver</li>
          <li>✓ No Instagram credentials uploaded</li>
        </ul>
        <strong>Media</strong>
        <ul>
          <li>✓ Direct source asset URLs</li>
          <li>✓ Media is not proxied through UniFetch</li>
          <li>✓ No download history stored</li>
        </ul>
      </div>
      <ul v-else>
        <li>
          {{
            result.trace.processedLocally
              ? '✓ Processed locally'
              : 'Not processed locally'
          }}
        </li>
        <li>
          {{
            result.trace.remoteProxyUsed
              ? 'Remote proxy used'
              : '✓ No remote UniFetch proxy'
          }}
        </li>
        <li>
          {{
            result.trace.credentialsExported
              ? 'Credentials exported'
              : '✓ Credentials not exported'
          }}
        </li>
      </ul>
      <strong>Network origins during resolution</strong>
      <ul v-if="result.trace.network.length">
        <li v-for="(record, index) in result.trace.network" :key="index">
          {{ record.origin }} · {{ record.purpose }}
        </li>
      </ul>
      <p v-else-if="result.source === 'fixture'">
        None. Fixture metadata is bundled locally. No real Instagram request
        occurred. Previews and downloads use local files served by this app.
      </p>
      <p v-else>No network origins were reported by the acquisition runtime.</p>
    </details>
  </section>
</template>
<style scoped>
.result-card {
  margin-top: 25px;
  padding: 24px;
  border: 1px solid var(--border);
  border-radius: 17px;
  background: white;
}
.result-heading {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
  border-bottom: 1px solid var(--border);
  padding-bottom: 18px;
}
.resolved-label {
  font-size: 13px;
  font-weight: 650;
  color: var(--green);
}
.resolved-label span {
  margin-right: 7px;
}
.type-label {
  font-size: 10px;
  color: var(--muted);
}
.source-label {
  color: var(--muted);
  font-size: 10px;
  margin: 14px 0 0;
}
.author {
  display: flex;
  gap: 11px;
  align-items: center;
  margin-top: 20px;
}
.avatar {
  width: 35px;
  height: 35px;
  background: #e5ece3;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--green);
  font-weight: 600;
}
.author strong {
  display: block;
  font-size: 12px;
}
.author span {
  display: block;
  font-size: 10px;
  color: var(--muted);
  margin-top: 4px;
}
.caption {
  font-size: 12px;
  line-height: 1.8;
  color: var(--muted);
  margin: 16px 0;
}
.media-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.media-grid.single {
  grid-template-columns: 1fr;
}
.preview {
  background: #eef1e9;
  border-radius: 9px;
  overflow: hidden;
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.single .preview {
  max-height: 440px;
  aspect-ratio: auto;
}
.preview img,
.preview video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.single .preview img,
.single .preview video {
  max-height: 440px;
}
.asset-details {
  padding: 11px 0;
  font-size: 11px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.asset-details > span,
.asset-details small {
  color: var(--muted);
  font-size: 10px;
}
.selection {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}
.selection input {
  accent-color: var(--green);
  width: 16px;
  height: 16px;
  margin: 0;
}
.download-actions {
  display: flex;
  gap: 10px;
  margin: 11px 0 20px;
}
.download-notice {
  font-size: 11px;
  line-height: 1.7;
  color: var(--muted);
}
.privacy {
  border-top: 1px solid var(--border);
  padding-top: 17px;
  font-size: 11px;
}
.privacy summary {
  cursor: pointer;
  font-weight: 650;
}
.privacy summary span {
  float: right;
  font-size: 10px;
  font-weight: 400;
  color: var(--muted);
}
.privacy ul {
  list-style: none;
  padding: 0;
  line-height: 2.2;
  color: var(--green);
}
.privacy strong {
  font-size: 10px;
}
.privacy p {
  line-height: 1.8;
  color: var(--muted);
  margin-bottom: 0;
}
@media (max-width: 480px) {
  .result-card {
    padding: 17px;
  }
  .download-actions {
    flex-direction: column;
  }
  .download-actions button {
    justify-content: center;
  }
  .media-grid {
    gap: 10px;
  }
  .privacy summary span {
    font-size: 9px;
  }
}
</style>
