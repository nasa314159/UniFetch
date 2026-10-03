<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { parseSharedPayload } from '@unifetch/share-target';
import { UniFetchError } from '@unifetch/core';
import { useResolutionStore } from '../stores/resolution';
import { resolutionErrorMessage } from '../error-messages';
import ResultPanel from '../components/ResultPanel.vue';
const store = useResolutionStore();
const input = ref('');
const route = useRoute();
const router = useRouter();
const resultRegion = ref<HTMLElement | null>(null);
async function submit() {
  await store.resolve(input.value);
  await nextTick();
  resultRegion.value?.focus();
}
async function demo(kind: string) {
  input.value = `https://www.instagram.com/${kind === 'reel' ? 'reel' : 'p'}/unifetch-demo-${kind}/`;
  await submit();
}
watch(
  () => route.fullPath,
  async () => {
    if (route.path !== '/share') return;
    const field = (key: string) =>
      typeof route.query[key] === 'string'
        ? (route.query[key] as string)
        : undefined;
    const url = parseSharedPayload({
      title: field('title'),
      text: field('text'),
      url: field('url'),
    });
    // Scrub all shared data before invoking the resolution flow.
    await router.replace('/');
    if (url) {
      input.value = url;
      await submit();
    } else
      store.fail(
        new UniFetchError(
          'INVALID_URL',
          'The shared content does not contain a supported HTTP or HTTPS URL.',
        ),
      );
  },
  { immediate: true },
);
</script>
<template>
  <section class="hero">
    <div class="eyebrow">
      <span aria-hidden="true">↙</span> YOUR MEDIA, YOUR DEVICE
    </div>
    <h1>
      Save media you<br class="desktop-break" />
      can already access<span class="period">.</span>
    </h1>
    <p class="tagline">Direct media. Transparently.</p>
    <p class="intro">
      One link. A clear view of your media.<br />Designed to keep you in
      control.
    </p>
  </section>
  <section class="input-card" aria-label="Resolve media">
    <div class="card-top">
      <label for="source-url">Paste an Instagram URL</label
      ><span class="fixture-badge">PREVIEW</span>
    </div>
    <form @submit.prevent="submit">
      <div class="input-wrap">
        <span aria-hidden="true">↗</span
        ><input
          id="source-url"
          v-model="input"
          type="text"
          inputmode="url"
          autocomplete="off"
          spellcheck="false"
          placeholder="https://www.instagram.com/p/…"
          :disabled="store.state === 'RESOLVING'"
          required
        />
      </div>
      <button
        class="primary"
        type="submit"
        :disabled="store.state === 'RESOLVING'"
      >
        <span
          v-if="store.state === 'RESOLVING'"
          class="spinner"
          aria-hidden="true"
        ></span
        >{{ store.state === 'RESOLVING' ? 'Resolving…' : 'Resolve'
        }}<span v-if="store.state !== 'RESOLVING'" aria-hidden="true">→</span>
      </button>
    </form>
    <p class="input-note">
      <span aria-hidden="true">♧</span> No login, cookies, or credentials needed
      for this demo.
    </p>
    <div class="demo-row">
      <span>Try a demo</span
      ><button :disabled="store.state === 'RESOLVING'" @click="demo('image')">
        Image <span aria-hidden="true">↗</span></button
      ><button
        :disabled="store.state === 'RESOLVING'"
        @click="demo('carousel')"
      >
        Carousel <span aria-hidden="true">↗</span></button
      ><button :disabled="store.state === 'RESOLVING'" @click="demo('reel')">
        Reel <span aria-hidden="true">↗</span>
      </button>
    </div>
  </section>
  <div
    ref="resultRegion"
    class="result-region"
    tabindex="-1"
    aria-live="polite"
    aria-atomic="true"
  >
    <p v-if="store.state === 'RESOLVING'" class="loading" role="status">
      Resolving your link locally…
    </p>
    <section v-if="store.state === 'ERROR'" class="error-card" role="alert">
      <strong>We couldn’t resolve this link</strong>
      <p>{{ store.error ? resolutionErrorMessage(store.error) : '' }}</p>
      <code>{{ store.error?.code }}</code>
    </section>
    <ResultPanel
      v-if="store.state === 'RESOLVED' && store.result"
      :key="store.result.post.id"
      :result="store.result"
    />
  </div>
  <section class="support-section">
    <h2>Starting with Instagram. Built for more.</h2>
    <div class="platform-grid">
      <article class="platform active">
        <span class="platform-icon" aria-hidden="true">◎</span>
        <div>
          <h3>Instagram <span class="status-dot"></span></h3>
          <p>Post · Carousel · Reel</p>
        </div>
        <span class="platform-status">Demo ready</span>
      </article>
      <article class="platform">
        <span class="platform-icon letter" aria-hidden="true">f</span>
        <div>
          <h3>Facebook</h3>
          <p>Coming soon</p>
        </div>
      </article>
      <article class="platform">
        <span class="platform-icon" aria-hidden="true">@</span>
        <div>
          <h3>Threads</h3>
          <p>Coming soon</p>
        </div>
      </article>
    </div>
  </section>
  <aside class="transparency">
    <span class="shield" aria-hidden="true">◇</span>
    <div>
      <h2>A little more transparency.</h2>
      <p>
        Demo buttons use fictional posts and original local media. Other public
        post and Reel URLs are sent to the UniFetch Resolver for metadata. Media
        files are not proxied through UniFetch, and no resolution history is
        stored.
      </p>
    </div>
  </aside>
</template>
<style scoped>
.hero {
  text-align: center;
  padding: 47px 0 34px;
}
.eyebrow {
  font-size: 10px;
  letter-spacing: 2.3px;
  font-weight: 650;
  color: var(--green);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
}
.eyebrow span {
  background: #e5ece3;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  font-size: 16px;
}
h1 {
  font-size: clamp(36px, 5.4vw, 58px);
  letter-spacing: -2.7px;
  line-height: 1.12;
  font-weight: 650;
  margin: 21px 0 14px;
}
.period {
  color: #70927a;
}
.tagline {
  font-size: 23px;
  color: var(--green);
  letter-spacing: -0.5px;
  margin: 0;
}
.intro {
  font-size: 14px;
  line-height: 1.7;
  color: var(--muted);
  margin: 18px 0 0;
}
.input-card {
  background: white;
  border: 1px solid var(--border);
  border-radius: 17px;
  padding: 25px;
  box-shadow: 0 8px 32px #273e2c05;
  max-width: 710px;
  margin: auto;
}
.card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 13px;
}
label {
  font-size: 13px;
  font-weight: 650;
}
.fixture-badge {
  font-size: 8px;
  letter-spacing: 1.2px;
  color: #6d785f;
  background: #f0f3e9;
  padding: 5px 7px;
  border-radius: 4px;
}
form {
  display: flex;
  gap: 10px;
}
.input-wrap {
  display: flex;
  align-items: center;
  gap: 9px;
  flex: 1;
  min-width: 0;
  background: #f8f9f6;
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 0 13px;
}
.input-wrap span {
  color: #8b958a;
}
input {
  font-size: 13px;
  padding: 16px 0;
  border: 0;
  outline: 0;
  background: transparent;
  width: 100%;
  min-width: 0;
  color: var(--ink);
}
.input-wrap:focus-within {
  outline: 2px solid #70927a;
  outline-offset: 2px;
}
input::placeholder {
  color: #9aa197;
}
.input-note {
  font-size: 11px;
  color: var(--muted);
  display: flex;
  gap: 6px;
  align-items: center;
  margin: 13px 0 20px;
}
.demo-row {
  border-top: 1px solid var(--border);
  padding-top: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--muted);
}
.demo-row > span {
  margin-right: auto;
}
.demo-row button {
  background: white;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 11px;
  color: var(--green);
}
.demo-row button span {
  margin-left: 7px;
  color: #879581;
}
.result-region {
  max-width: 710px;
  margin: auto;
  outline: none;
}
.error-card {
  margin-top: 22px;
  background: #fff5f0;
  border: 1px solid #edd5c8;
  border-radius: 12px;
  padding: 22px;
  font-size: 13px;
}
.error-card p {
  line-height: 1.7;
  color: #775e50;
}
.error-card code {
  font-size: 10px;
  color: #775e50;
}
.loading {
  text-align: center;
  font-size: 13px;
  color: var(--muted);
  padding: 16px;
}
.support-section {
  max-width: 830px;
  margin: 43px auto 0;
}
.support-section > h2 {
  font-size: 12px;
  font-weight: 500;
  text-align: center;
  color: var(--muted);
  margin-bottom: 19px;
}
.platform-grid {
  display: grid;
  grid-template-columns: 1.25fr 1fr 1fr;
  gap: 12px;
}
.platform {
  border: 1px solid var(--border);
  border-radius: 11px;
  padding: 17px 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  background: #f8f9f5;
}
.platform.active {
  background: white;
}
.platform-icon {
  width: 32px;
  height: 32px;
  background: #f0f2eb;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-size: 26px;
  color: #62715b;
}
.letter {
  font-family: Georgia, serif;
  font-size: 29px;
}
.platform h3 {
  font-size: 12px;
  margin: 0 0 5px;
  font-weight: 650;
  display: flex;
  gap: 7px;
  align-items: center;
}
.platform p {
  font-size: 10px;
  color: var(--muted);
  margin: 0;
}
.status-dot {
  width: 5px;
  height: 5px;
  background: #608667;
  border-radius: 50%;
}
.platform-status {
  font-size: 8px;
  color: var(--green);
  margin-left: auto;
}
.transparency {
  display: flex;
  gap: 14px;
  max-width: 650px;
  margin: 37px auto 0;
  padding: 0 13px;
}
.shield {
  font-size: 27px;
  color: #71836a;
}
.transparency h2 {
  font-size: 12px;
  margin: 2px 0 7px;
}
.transparency p {
  font-size: 11px;
  line-height: 1.8;
  color: var(--muted);
  margin: 0;
}
@media (max-width: 600px) {
  .hero {
    padding: 33px 0 29px;
  }
  h1 {
    letter-spacing: -1.6px;
  }
  .tagline {
    font-size: 20px;
  }
  .input-card {
    padding: 19px 16px;
  }
  form {
    flex-direction: column;
  }
  .primary {
    justify-content: center;
  }
  .input-note {
    font-size: 10px;
    line-height: 1.5;
  }
  .platform-grid {
    grid-template-columns: 1fr;
  }
  .platform {
    padding: 13px 16px;
  }
  .platform p {
    font-size: 11px;
  }
  .platform h3 {
    font-size: 13px;
  }
  .platform-status {
    font-size: 10px;
  }
  .support-section {
    margin-top: 30px;
  }
  .demo-row {
    gap: 6px;
  }
  .demo-row button {
    padding: 7px 8px;
  }
  .demo-row button span {
    margin-left: 3px;
  }
  .intro {
    font-size: 13px;
  }
}
</style>
