<script setup lang="ts">
import { ref } from 'vue';
const installEvent = ref<(Event & { prompt(): Promise<void> }) | null>(null);
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installEvent.value = event as Event & { prompt(): Promise<void> };
});
async function install() {
  await installEvent.value?.prompt();
  installEvent.value = null;
}
</script>
<template>
  <div class="app-shell">
    <header class="topbar">
      <RouterLink class="brand" to="/" aria-label="UniFetch home"
        ><img src="/icon.svg" alt="" width="34" height="34" />UniFetch<span
          class="beta"
          >PREVIEW</span
        ></RouterLink
      ><button v-if="installEvent" class="install" @click="install">
        Install app <span aria-hidden="true">↗</span></button
      ><span v-else class="local-mark"><span></span> Local by design</span>
    </header>
    <main><RouterView /></main>
    <footer>
      <span>UniFetch · Built around your privacy.</span
      ><span>No accounts. No tracking. Open source.</span>
    </footer>
  </div>
</template>
<style scoped>
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 26px 0;
}
.brand {
  display: flex;
  gap: 10px;
  align-items: center;
  color: var(--ink);
  font-size: 21px;
  font-weight: 750;
  text-decoration: none;
  letter-spacing: -0.7px;
}
.beta {
  font-size: 9px;
  letter-spacing: 1.3px;
  color: var(--muted);
  background: var(--soft);
  border: 1px solid var(--border);
  padding: 5px 7px;
  border-radius: 5px;
  margin-left: 3px;
}
.local-mark {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--muted);
}
.local-mark span {
  width: 6px;
  height: 6px;
  background: #53876a;
  border-radius: 50%;
}
.install {
  background: white;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 9px 13px;
  color: var(--ink);
  font-size: 12px;
}
footer {
  border-top: 1px solid var(--border);
  margin-top: 62px;
  padding: 23px 0 30px;
  display: flex;
  justify-content: space-between;
  color: var(--muted);
  font-size: 11px;
}
@media (max-width: 540px) {
  .topbar {
    padding: 20px 0;
  }
  .local-mark {
    font-size: 10px;
  }
  .beta {
    display: none;
  }
  footer {
    gap: 10px;
    flex-direction: column;
    margin-top: 38px;
  }
}
</style>
