import { describe, expect, it, vi, afterEach } from 'vitest';
import { inspectMediaStructure } from './dev-structure';
import { createWorker } from './index';
import raw from '../../../packages/meta-resolver/src/instagram/__fixtures__/nullable-image-response.json';
afterEach(() => vi.unstubAllGlobals());
describe('Dev-only safe structure inspection', () => {
  it('reports the exact nullable field mismatch without content values', () => {
    const structure = inspectMediaStructure(raw);
    expect(structure.items.first.fields.carousel_media).toEqual({
      present: true,
      null: true,
      type: 'null',
    });
    expect(structure.items.first.media_type).toBe(1);
    expect(structure.items.first.product_type).toBe('feed');
    expect(structure.image_versions2.candidates).toMatchObject({
      type: 'array',
      length: 1,
    });
    const output = JSON.stringify(structure);
    for (const hidden of [
      'fictional-nullable-image',
      'synthetic-nullable-image',
      'fictional_nullable_artist',
      'Fictional Shape Studio',
      'fictional postcard',
      'media.invalid',
      'signature=',
    ])
      expect(output).not.toContain(hidden);
  });
  it('does not output unknown product values, numeric dimensions, timestamps or arbitrary strings', () => {
    const modified = structuredClone(raw);
    const item = modified.data.xdt_api__v1__media__shortcode__web_info.items[0];
    item.product_type = 'private-value';
    item.image_versions2.candidates[0].width = 123456;
    const output = JSON.stringify(inspectMediaStructure(modified));
    expect(output).not.toContain('private-value');
    expect(output).not.toContain('123456');
  });
  it('only examines the requested fields and immediate containers', () => {
    const structure = inspectMediaStructure({
      data: {
        xdt_api__v1__media__shortcode__web_info: {
          items: [
            {
              nested: {
                image_versions2: {},
                secret: { nestedAgain: 'hidden' },
              },
            },
          ],
        },
      },
    });
    expect(structure.immediateContainers).toContainEqual(
      expect.objectContaining({
        name: 'nested',
        fields: {
          image_versions2: expect.objectContaining({
            present: true,
            type: 'object',
          }),
        },
      }),
    );
    expect(JSON.stringify(structure)).not.toContain('nestedAgain');
  });
  it('identifies GraphQL execution errors structurally without messages', () => {
    const structure = inspectMediaStructure({
      data: null,
      errors: [{ message: 'Synthetic private detail' }],
    });
    expect(structure.root.data.null).toBe(true);
    expect(structure.root.errors.length).toBe(1);
    expect(structure.errorCategory).toBe('GRAPHQL_EXECUTION_ERROR');
    expect(JSON.stringify(structure)).not.toContain('Synthetic private detail');
  });
  it('classifies missing media caused by GraphQL errors before invoking the media parser', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          headers: { 'Set-Cookie': 'csrftoken=synthetic; Path=/' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: null,
            errors: [{ message: 'Synthetic execution error' }],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
      );
    const observed: string[] = [];
    const response = await createWorker(fetcher, (record) =>
      observed.push(record.stage),
    ).fetch(
      new Request('http://127.0.0.1/api/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: 'https://instagram.com/p/synthetic-structural/',
        }),
      }),
      { ALLOWED_ORIGINS: '' },
    );
    expect((await response.json()).error.code).toBe('UNKNOWN');
    expect(observed).not.toContain('PARSER');
  });
});
