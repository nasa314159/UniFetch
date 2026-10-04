import { inspectInstagramGraphql } from '@unifetch/meta-resolver/instagram';
/** Bounded structural observations only. Imported by the local diagnostic entry, not production. */
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function keys(value: unknown) {
  return Object.keys(object(value) ?? {})
    .filter((key) => /^[A-Za-z_][A-Za-z0-9_]{0,95}$/.test(key))
    .slice(0, 100);
}
function field(parent: unknown, name: string) {
  const node = object(parent);
  const value = node?.[name];
  return {
    present: Boolean(node && Object.hasOwn(node, name)),
    null: value === null,
    type:
      value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
    ...(Array.isArray(value) ? { length: value.length } : {}),
  };
}
function candidate(value: unknown) {
  return {
    url: field(value, 'url'),
    width: field(value, 'width'),
    height: field(value, 'height'),
  };
}
const mediaFields = [
  'media_type',
  'product_type',
  'image_versions2',
  'video_versions',
  'carousel_media',
  'user',
  'caption',
  'taken_at',
] as const;
function media(value: unknown) {
  const node = object(value);
  return {
    keys: keys(value),
    fields: Object.fromEntries(
      mediaFields.map((key) => [key, field(value, key)]),
    ),
    ...(typeof node?.media_type === 'number' && Number.isFinite(node.media_type)
      ? { media_type: node.media_type }
      : {}),
    ...(['feed', 'clips', 'carousel_container'].includes(
      String(node?.product_type),
    )
      ? { product_type: node?.product_type }
      : {}),
  };
}
export function inspectMediaStructure(raw: unknown) {
  const root = object(raw);
  const data = object(root?.data);
  const web = object(data?.xdt_api__v1__media__shortcode__web_info);
  const items = Array.isArray(web?.items) ? web.items : undefined;
  const first = object(items?.[0]);
  const images = object(first?.image_versions2);
  const candidates = Array.isArray(images?.candidates) ? images.candidates : [];
  const videos = Array.isArray(first?.video_versions)
    ? first.video_versions
    : [];
  const children = Array.isArray(first?.carousel_media)
    ? first.carousel_media
    : [];
  const errorCategory = inspectInstagramGraphql(raw).category;
  return {
    root: {
      keys: keys(raw),
      data: field(raw, 'data'),
      errors: field(raw, 'errors'),
      extensions: field(raw, 'extensions'),
    },
    data: {
      keys: keys(data),
      web_info: field(data, 'xdt_api__v1__media__shortcode__web_info'),
    },
    web_info: { keys: keys(web), items: field(web, 'items') },
    items: { ...(items ? { length: items.length } : {}), first: media(first) },
    image_versions2: {
      candidates: field(images, 'candidates'),
      entries: candidates.slice(0, 100).map(candidate),
    },
    video_versions: {
      field: field(first, 'video_versions'),
      entries: videos.slice(0, 100).map(candidate),
    },
    carousel_media: {
      field: field(first, 'carousel_media'),
      children: children.slice(0, 100).map((entry) => media(entry)),
    },
    immediateContainers: Object.entries(first ?? {})
      .filter(([, value]) => object(value))
      .slice(0, 100)
      .map(([name, value]) => ({
        name: /^[A-Za-z_][A-Za-z0-9_]{0,95}$/.test(name) ? name : 'other',
        keys: keys(value),
        fields: Object.fromEntries(
          mediaFields
            .filter((key) => Object.hasOwn(object(value)!, key))
            .map((key) => [key, field(value, key)]),
        ),
      })),
    ...(errorCategory ? { errorCategory } : {}),
  };
}
