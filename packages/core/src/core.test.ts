import { describe, expect, it } from 'vitest';
import {
  parseSupportedUrl,
  ResolverRegistry,
  UniFetchError,
  asUniFetchError,
  type RuntimeAdapter,
} from './index';
const runtime: RuntimeAdapter = {
  request: async () => {
    throw new Error('No network allowed');
  },
  download: async () => {},
  capabilities: () => ({ downloads: true, crossOriginRequests: false }),
};
describe('URL parsing and normalization', () => {
  it.each(['instagram.com', 'www.instagram.com', 'm.instagram.com'])(
    'recognizes %s',
    (host) => {
      const result = parseSupportedUrl(`https://${host}/p/example/`);
      expect(result.platform).toBe('instagram');
      expect(result.url.hostname).toBe('www.instagram.com');
    },
  );
  it.each(['facebook.com', 'www.facebook.com', 'fb.watch'])(
    'detects Facebook host %s',
    (host) =>
      expect(parseSupportedUrl(`https://${host}/example`).platform).toBe(
        'facebook',
      ),
  );
  it.each(['threads.net', 'www.threads.net', 'threads.com', 'www.threads.com'])(
    'detects Threads host %s',
    (host) =>
      expect(parseSupportedUrl(`https://${host}/example`).platform).toBe(
        'threads',
      ),
  );
  it.each([
    'not a url',
    '',
    'javascript:alert(1)',
    'data:text/html,x',
    'file:///tmp/a',
    'https://user:pass@instagram.com/p/x',
    'https://instagram.com:8080/p/x',
  ])('rejects unsafe or invalid input %s', (value) => {
    expect(() => parseSupportedUrl(value)).toThrow(UniFetchError);
    try {
      parseSupportedUrl(value);
    } catch (error) {
      expect(asUniFetchError(error).code).toBe('INVALID_URL');
    }
  });
  it('rejects lookalike and unsupported hosts', () => {
    expect(() =>
      parseSupportedUrl('https://instagram.com.evil.example/p/x'),
    ).toThrow('not from');
  });
  it('removes only known tracking and fragment', () => {
    const { url } = parseSupportedUrl(
      'https://m.instagram.com/p/x/?utm_source=x&utm_medium=x&utm_campaign=x&utm_content=x&utm_term=x&igsh=x&img_index=2&custom=yes#fragment',
    );
    expect(url.href).toBe(
      'https://www.instagram.com/p/x/?img_index=2&custom=yes',
    );
  });
  it('allows http', () =>
    expect(parseSupportedUrl('http://instagram.com/p/x').url.protocol).toBe(
      'http:',
    ));
  it('handles normalized URLs idempotently', () => {
    const first = parseSupportedUrl(
      'https://m.instagram.com/p/x?igsh=abc&key=value',
    ).url.href;
    expect(parseSupportedUrl(first).url.href).toBe(first);
  });
  it.each(['https://facebook.com/a', 'https://threads.net/a'])(
    'returns planned-platform error for %s',
    async (url) => {
      await expect(
        new ResolverRegistry(runtime, []).resolve(url),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' });
    },
  );
  it('does not expose unknown errors or stack traces', () =>
    expect(
      asUniFetchError(new Error('secret session value')).message,
    ).not.toContain('secret'));
});
