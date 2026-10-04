<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
const props = defineProps<{ open: boolean; ios: boolean }>();
const emit = defineEmits<{ dismiss: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
watch(
  () => props.open,
  async (open) => {
    await nextTick();
    if (!dialog.value) return;
    if (open && !dialog.value.open) dialog.value.showModal();
    else if (!open && dialog.value.open) dialog.value.close();
  },
  { immediate: true },
);
function dismiss() {
  dialog.value?.close();
  emit('dismiss');
}
</script>
<template>
  <dialog
    ref="dialog"
    class="install-sheet"
    aria-labelledby="install-title"
    @keydown.tab.prevent="closeButton?.focus()"
    @close="emit('dismiss')"
  >
    <h2 id="install-title">Install UniFetch</h2>
    <ol v-if="ios">
      <li>Tap the Share button in Safari.</li>
      <li>Choose “Add to Home Screen”.</li>
      <li>Tap “Add”.</li>
    </ol>
    <p v-else>Use your browser’s Install app / Add to Home Screen option.</p>
    <p class="note">
      After installation, UniFetch opens like an app from the Home Screen.
    </p>
    <button ref="closeButton" class="secondary" autofocus @click="dismiss">
      Close
    </button>
  </dialog>
</template>
<style scoped>
.install-sheet {
  box-sizing: border-box;
  width: min(420px, calc(100% - 32px));
  max-height: calc(100dvh - 40px);
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 17px;
  padding: 25px;
  color: var(--ink);
  background: white;
  box-shadow: 0 12px 50px #273e2c20;
}
.install-sheet::backdrop {
  background: #1d2a2460;
}
h2 {
  font-size: 20px;
  margin: 0 0 18px;
}
ol {
  padding-left: 22px;
}
li,
p {
  font-size: 14px;
  line-height: 1.7;
}
li {
  padding-left: 3px;
  margin-bottom: 7px;
}
.note {
  font-size: 12px;
  color: var(--muted);
  margin: 18px 0;
}
button {
  width: 100%;
}
</style>
