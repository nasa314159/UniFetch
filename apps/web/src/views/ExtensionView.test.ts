import { describe, expect, it } from 'vitest';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createMemoryHistory, createRouter } from 'vue-router';
import ExtensionView from './ExtensionView.vue';
import extensionViewSource from './ExtensionView.vue?raw';
import {
  EXTENSION_RELEASE,
  hasVerifiedRelease,
} from '../config/extension-release';

async function renderInstallPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<p>Home</p>' } },
      { path: '/extension', component: ExtensionView },
    ],
  });
  await router.push('/extension');
  await router.isReady();
  const html = await renderToString(createSSRApp(ExtensionView).use(router));
  return { html, text: html.replace(/\s+/g, ' ') };
}

describe('extension installation route', () => {
  it('renders the installation entry and either a verified release or an honest unavailable state', async () => {
    const { html, text } = await renderInstallPage();
    expect(text).toContain('Install Browser Extension');
    expect(text).toContain('Download for Chrome / Chromium');
    expect(text).toContain('GitHub Releases');
    if (hasVerifiedRelease()) {
      expect(text).toContain('Download ZIP');
      expect(html).toContain(EXTENSION_RELEASE.downloadUrl ?? '');
      expect(text).toContain(EXTENSION_RELEASE.fileName);
      expect(text).toContain(EXTENSION_RELEASE.sha256 ?? '');
      expect(html).toContain('download');
    } else {
      expect(text).toContain('Release not yet available');
      expect(html).not.toContain('class="download-action"');
    }
  });

  it('provides the complete nontechnical unpacked-install flow', async () => {
    const { html, text } = await renderInstallPage();
    for (const step of [
      'Download the ZIP',
      'Extract it to a permanent folder',
      'chrome://extensions',
      'Enable Developer mode',
      'Load unpacked',
      'Select the folder containing manifest.json',
      'Open Instagram or a public Threads post',
    ]) {
      expect(text).toContain(step);
    }
    expect(html).toMatch(/Copy\s*<code[^>]*>chrome:\/\/extensions<\/code>/);
    expect(text).toContain('Keep this folder');
    expect(text).toContain('Updates are manual');
    expect(text).toContain('Chrome documentation: load an unpacked extension');
  });

  it('distinguishes Web/PWA public downloads from authenticated extension downloads', async () => {
    const { text } = await renderInstallPage();
    expect(text).toContain('UniFetch Web/PWA');
    expect(text).toContain('Public Post, Carousel and Reel metadata');
    expect(text).toContain('No Instagram or Threads login required');
    expect(text).toContain('Authenticated Post, Carousel and Reel downloads');
    expect(text).toContain(
      'Stories only when the link already contains an explicit Story ID',
    );
    expect(text).toContain(
      'Public Threads image, video, carousel and GIF downloads',
    );
    expect(text).toContain(
      'Optional threads.com permission requested only for Threads links',
    );
  });

  it('states the real installation and support limitations', async () => {
    const { html, text } = await renderInstallPage();
    expect(text).toContain('Not listed in the Chrome Web Store');
    expect(text).toContain(
      'Downloading the ZIP does not install the extension by itself.',
    );
    expect(text).toContain('Developer mode is required');
    expect(text).toContain(
      'Username-only Stories, Highlights and Story enumeration are not supported',
    );
    expect(text).toContain(
      'Installing it does not grant access to content you cannot already view.',
    );
    expect(text).toContain('declarativeNetRequestWithHostAccess');
    expect(text).toContain('https://www.threads.com/*');
    expect(text).toContain('Threads access denied');
    expect(html).not.toMatch(/\bany Story\b/i);
    expect(html).not.toMatch(/\ball Stories\b/i);
    expect(html).not.toContain('Firefox');
  });

  it('does not claim Chrome Web Store publication or automatic installation', async () => {
    const { html } = await renderInstallPage();
    expect(html).not.toMatch(
      /(?:is|was) (?:published|available|listed) (?:in|on) the Chrome Web Store/i,
    );
    expect(html).not.toMatch(/install (?:it )?from the Chrome Web Store/i);
    expect(html).not.toMatch(/installs? (?:the extension )?automatically/i);
    expect(html).toContain('Not listed in the Chrome Web Store');
  });

  it('targets desktop Chromium and tells mobile visitors not to follow it', async () => {
    const { text } = await renderInstallPage();
    expect(text).toContain('This installation flow is for desktop browsers.');
    expect(text).toContain('cannot load unpacked Chromium extensions');
    expect(text).toContain('Open the UniFetch Web/PWA');
    expect(extensionViewSource).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.desktop-flow\s*\{\s*display: none;/,
    );
    expect(extensionViewSource).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.mobile-note\s*\{\s*display: block;/,
    );
    expect(extensionViewSource).toMatch(/\.mobile-note\s*\{\s*display: none;/);
  });

  it('shows an honest unavailable state instead of a dead download button', () => {
    expect(extensionViewSource).toContain('Release not yet available');
    expect(extensionViewSource).toContain('v-if="releaseAvailable"');
    expect(extensionViewSource).toContain('v-else');
    expect(extensionViewSource).toContain('EXTENSION_RELEASE.releasesUrl');
  });
});
