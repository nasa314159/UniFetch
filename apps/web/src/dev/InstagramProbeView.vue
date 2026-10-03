<script setup lang="ts">
import { ref } from 'vue';
import {
  runInstagramProbe,
  type InstagramProbeInputs,
  type InstagramProbeOutcome,
} from './instagram-probe';
const inputs = ref<InstagramProbeInputs>({
  imagePost: '',
  carousel: '',
  reel: '',
});
const report = ref<Record<
  keyof InstagramProbeInputs,
  InstagramProbeOutcome
> | null>(null);
const running = ref(false);
async function run() {
  running.value = true;
  report.value = null;
  const supplied = { ...inputs.value };
  inputs.value = { imagePost: '', carousel: '', reel: '' };
  try {
    report.value = await runInstagramProbe(supplied);
  } finally {
    running.value = false;
  }
}
</script>
<template>
  <section class="probe">
    <h1>Developer-only Instagram probe</h1>
    <p>
      Supply exactly one public image post, one public carousel, and one public
      Reel. Inputs clear on submission. Only high-level results are shown;
      nothing is logged or stored.
    </p>
    <form @submit.prevent="run">
      <label
        >Public image post URL<input
          v-model="inputs.imagePost"
          required
          autocomplete="off"
          :disabled="running"
      /></label>
      <label
        >Public carousel URL<input
          v-model="inputs.carousel"
          required
          autocomplete="off"
          :disabled="running"
      /></label>
      <label
        >Public Reel URL<input
          v-model="inputs.reel"
          required
          autocomplete="off"
          :disabled="running"
      /></label>
      <button class="primary" :disabled="running">
        {{ running ? 'Testing…' : 'Run three public probes' }}
      </button>
    </form>
    <ul v-if="report" aria-live="polite">
      <li v-for="(outcome, key) in report" :key="key">
        {{ key }}: {{ outcome.status
        }}<template v-if="outcome.status === 'SUCCESS'">
          · {{ outcome.assetCount }} assets ·
          {{ outcome.assetTypes?.join(', ') }}</template
        >
      </li>
    </ul>
  </section>
</template>
<style scoped>
.probe {
  max-width: 700px;
  margin: 35px auto;
}
h1 {
  font-size: 24px;
}
p {
  font-size: 13px;
  line-height: 1.7;
  color: var(--muted);
}
form {
  display: grid;
  gap: 16px;
  margin-top: 25px;
}
label {
  display: grid;
  gap: 8px;
  font-size: 13px;
}
input {
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  width: 100%;
  background: white;
}
ul {
  font-size: 12px;
  line-height: 2;
  overflow-wrap: anywhere;
}
</style>
