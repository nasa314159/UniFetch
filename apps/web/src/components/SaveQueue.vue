<script setup lang="ts">
import { computed } from 'vue';
import {
  batchDownloadSummary,
  type BatchDownloadResult,
} from '@unifetch/downloader';
const props = defineProps<{
  result: BatchDownloadResult;
  preparedIndices: number[];
}>();
const emit = defineEmits<{
  save: [index: number];
  confirm: [index: number];
  retry: [index: number];
}>();
const summary = computed(() => batchDownloadSummary(props.result));
</script>
<template>
  <section class="save-queue" aria-label="Ready to save">
    <strong>Ready to save</strong>
    <p class="download-notice" role="status">{{ summary }}</p>
    <p class="download-notice">
      Save each file if needed, then check your browser’s Downloads and tap
      Confirm saved. A save request alone cannot prove the browser saved a file.
    </p>
    <ul>
      <li v-for="item in result.results" :key="item.index">
        <span class="save-filename"
          >Asset {{ item.index + 1 }} · {{ item.filename }}</span
        >
        <span v-if="item.status === 'downloaded'">✓ Saved (confirmed)</span>
        <span v-else-if="item.status === 'preparing'">Preparing…</span>
        <template v-else>
          <span v-if="item.errorCode"
            >{{
              item.status === 'browser-restricted'
                ? 'Source unreadable'
                : 'Save attempt failed'
            }}
            ({{ item.errorCode }})</span
          >
          <span v-else-if="item.status === 'requested'"
            >Save requested; awaiting confirmation</span
          >
          <span v-else>Needs saving</span>
          <button
            v-if="preparedIndices.includes(item.index)"
            class="secondary"
            @click="emit('save', item.index)"
          >
            {{ item.status === 'requested' ? 'Save again' : 'Save' }} Asset
            {{ item.index + 1 }}
          </button>
          <button v-else class="secondary" @click="emit('retry', item.index)">
            Retry Asset {{ item.index + 1 }}
          </button>
          <button
            v-if="item.status === 'requested'"
            class="secondary"
            @click="emit('confirm', item.index)"
          >
            Confirm saved · Asset {{ item.index + 1 }}
          </button>
        </template>
        <small v-if="item.formatFallback">Kept original image format.</small>
      </li>
    </ul>
    <details class="download-diagnostics">
      <summary>Download diagnostics</summary>
      <p>
        Local status only; no URLs or content are logged. Fetch rejection cannot
        distinguish CORS from network failure. A dispatched click does not
        confirm a saved file.
      </p>
      <p v-for="item in result.results" :key="item.index">
        Asset {{ item.index + 1 }}: fetch {{ item.diagnostics?.fetch }}; Blob
        {{ item.diagnostics?.blobMime || 'unavailable' }} /
        {{ item.diagnostics?.blobSize ?? 0 }} bytes; object URL
        {{ item.diagnostics?.objectUrlCreated ? 'created' : 'not created' }};
        click
        {{
          item.diagnostics?.anchorClickAttempted
            ? 'attempted'
            : 'not attempted'
        }}; {{ item.status }}.
      </p>
    </details>
  </section>
</template>
<style scoped>
.save-queue {
  border-top: 1px solid var(--border);
  padding: 16px 0;
  font-size: 12px;
}
.save-queue ul {
  list-style: none;
  padding: 0;
}
.save-queue li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 14px 0;
  font-size: 11px;
}
.save-filename {
  width: 100%;
  overflow-wrap: anywhere;
}
.download-diagnostics {
  color: var(--muted);
  font-size: 10px;
  line-height: 1.7;
}
.download-notice {
  font-size: 11px;
  line-height: 1.7;
  color: var(--muted);
}
</style>
