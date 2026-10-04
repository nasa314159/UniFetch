import { describe, expect, it } from 'vitest';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import type {
  AssetDownloadStatus,
  BatchDownloadResult,
} from '@unifetch/downloader';
import SaveQueue from './SaveQueue.vue';
async function render(statuses: AssetDownloadStatus[]) {
  const result: BatchDownloadResult = {
    requested: 4,
    completed: statuses.filter((status) => status === 'downloaded').length,
    results: statuses.map((status, index) => ({
      index,
      status,
      filename: `fictional_studio_${String(index + 1).padStart(2, '0')}.jpg`,
      errorCode:
        status === 'browser-restricted' ? 'BROWSER_RESTRICTION' : undefined,
    })),
  };
  return renderToString(
    createSSRApp(SaveQueue, {
      result,
      preparedIndices: statuses.flatMap((status, index) =>
        ['ready', 'requested'].includes(status) ? [index] : [],
      ),
    }),
  );
}
describe('Rendered per-file save queue', () => {
  it('offers four explicit Save actions without pretending prepared files were saved', async () => {
    const html = await render(['ready', 'ready', 'ready', 'ready']);
    for (const index of [1, 2, 3, 4])
      expect(html).toContain(`Save Asset ${index}`);
    expect(html).toContain('Downloaded 0 of 4');
    expect(html).toContain('4 files still need saving or confirmation');
    expect(html).not.toContain('Downloaded 4 of 4');
    expect(html).not.toContain('Confirm saved ·');
  });
  it('isolates a failed asset and does not offer already confirmed files again', async () => {
    const html = await render([
      'downloaded',
      'browser-restricted',
      'ready',
      'ready',
    ]);
    expect(html).toContain('Downloaded 1 of 4');
    expect(html).toContain('Source unreadable (BROWSER_RESTRICTION)');
    expect(html).toContain('Retry Asset 2');
    expect(html).toContain('Save Asset 4');
    expect(html).not.toContain('Save Asset 1');
    expect(html).not.toContain('Retry Asset 1');
    expect(html).toContain('fictional_studio_04.jpg');
  });
  it('requires save confirmation before rendering an all-complete state', async () => {
    const pending = await render([
      'downloaded',
      'downloaded',
      'downloaded',
      'requested',
    ]);
    expect(pending).toContain('Confirm saved · Asset 4');
    expect(pending).toContain('Save again Asset 4');
    expect(pending).not.toContain('Downloaded 4 of 4');
    const completed = await render([
      'downloaded',
      'downloaded',
      'downloaded',
      'downloaded',
    ]);
    expect(completed).toContain('Downloaded 4 of 4 (confirmed).');
    expect(completed).not.toContain('Confirm saved ·');
    expect(completed).not.toContain('Save again Asset');
  });
});
