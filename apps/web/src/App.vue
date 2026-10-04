<script setup lang="ts">
import { usePwaInstall, isIosDevice } from './composables/usePwaInstall';
import InstallInstructions from './components/InstallInstructions.vue';
const showIosShortcutSetup =
  typeof navigator !== 'undefined' && isIosDevice(navigator);
const {
  showInstallAction,
  prompting,
  showInstructions,
  requiresIosInstructions,
  install,
  dismissInstructions,
} = usePwaInstall();
</script>
<template>
  <div class="app-shell">
    <header class="topbar">
      <RouterLink class="brand" to="/" aria-label="UniFetch home"
        ><img src="/icon.svg" alt="" width="34" height="34" />UniFetch<span
          class="beta"
          >PREVIEW</span
        ></RouterLink
      ><button
        v-if="showInstallAction"
        class="install"
        :disabled="prompting"
        @click="install"
      >
        Install <span aria-hidden="true">↗</span></button
      ><span v-else class="local-mark"><span></span> No media proxy</span>
    </header>
    <InstallInstructions
      :open="showInstructions"
      :ios="requiresIosInstructions"
      @dismiss="dismissInstructions"
    />
    <main><RouterView /></main>
    <section
      v-if="showIosShortcutSetup"
      class="ios-share-setup"
      aria-label="Set up Instagram sharing"
    >
      <a
        class="shortcut-action"
        href="https://www.icloud.com/shortcuts/9ff25727f16a43cfa6eac1e3ccd49a82"
        target="_blank"
        rel="noopener noreferrer"
        >Add UniFetch Shortcut <span aria-hidden="true">↗</span></a
      >
      <p>
        On iOS, the installed PWA does not appear directly in the Share Sheet.
        Add the UniFetch Shortcut, then choose UniFetch in Instagram’s Share
        Sheet.
      </p>
      <details>
        <summary>Manual setup fallback</summary>
        <ol>
          <li>
            In Shortcuts, create <strong>UniFetch</strong>. Enable
            <strong>Show in Share Sheet</strong>; accept URLs, Safari web pages,
            and Text.
          </li>
          <li>
            Add <strong>Get URLs from Input</strong> using Shortcut Input. If
            URLs is empty, show an alert and stop. Otherwise, add
            <strong>Get Item from List</strong> → First Item.
          </li>
          <li>
            Use <strong>Match Text</strong> on First Item with the pattern
            below.
          </li>
          <li>
            If Matches has any value, add <strong>URL Encode</strong> → Encode.
            In <strong>Text</strong>, append its output variable to
            <code>https://unifetch.pages.dev/share?url=</code>, then use
            <strong>Open URLs</strong> on Text. Otherwise, show “UniFetch
            couldn’t find a supported Instagram link in the shared item.”
          </li>
        </ol>
        <p>Match Text pattern (copy exactly):</p>
        <code
          >(?i)^https://(?:www\.)?instagram\.com/(?:p|reel|reels)/[A-Za-z0-9_-]+/?(?:\?[^\s#]*)?(?:#[^\s]*)?$</code
        >
        <p>
          Set “If there’s no input” to Continue. For an empty URLs list, use
          Show Alert followed by Stop and Output with no output (Do Nothing).
        </p>
        <p>
          The Shortcut only forwards the shared URL. It may open Safari instead
          of the Home Screen app. UniFetch resolves automatically; no copy/paste
          is needed.
        </p>
      </details>
    </section>
    <footer>
      <span>UniFetch · Built around your privacy.</span
      ><span>No accounts. No tracking. Open source.</span>
    </footer>
  </div>
</template>
<style scoped>
.ios-share-setup {
  max-width: 710px;
  margin: 25px auto 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.8;
}
.shortcut-action {
  display: inline-block;
  padding: 9px 13px;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--green);
  text-decoration: none;
  font-weight: 600;
}
.ios-share-setup summary {
  cursor: pointer;
  color: var(--green);
}
.ios-share-setup li {
  margin-bottom: 8px;
}
.ios-share-setup code {
  overflow-wrap: anywhere;
}
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
