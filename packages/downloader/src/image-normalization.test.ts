import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeJpeg, normalizeStillImage } from './image-normalization';
const jpeg = () => new Blob(['fictional jpeg'], { type: 'image/jpeg' });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('Still-image normalization', () => {
  it('retains original JPEG bytes without re-encoding', async () => {
    const original = jpeg();
    const encode = vi.fn();
    expect(await normalizeStillImage(original, encode)).toEqual({
      blob: original,
      converted: false,
      fallback: false,
    });
    expect(encode).not.toHaveBeenCalled();
  });
  it.each(['image/webp', 'image/png', 'image/avif'])(
    'converts %s to JPEG',
    async (type) => {
      const original = new Blob(['fictional'], { type });
      const output = jpeg();
      const encode = vi.fn().mockResolvedValue(output);
      expect(await normalizeStillImage(original, encode)).toEqual({
        blob: output,
        converted: true,
        fallback: false,
      });
      expect(encode).toHaveBeenCalledExactlyOnceWith(original);
    },
  );
  it('retains original MIME and bytes after conversion failure', async () => {
    const original = new Blob(['fictional'], { type: 'image/webp' });
    expect(
      await normalizeStillImage(original, async () => {
        throw new Error('Decode failed');
      }),
    ).toEqual({ blob: original, converted: false, fallback: true });
  });
  it('rejects an encoder that returns non-JPEG or empty output', async () => {
    const original = new Blob(['fictional'], { type: 'image/png' });
    for (const output of [original, new Blob([], { type: 'image/jpeg' })])
      expect(
        (await normalizeStillImage(original, async () => output)).blob,
      ).toBe(original);
  });
});
function nativeMocks() {
  const bitmap = { width: 432, height: 765, close: vi.fn() };
  const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toBlob: vi.fn((callback: (blob: Blob | null) => void) => callback(jpeg())),
  };
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
  return { bitmap, context, canvas };
}
describe('Browser-native JPEG encoder', () => {
  it('uses decoded dimensions, white alpha background, orientation and quality without upscaling', async () => {
    const { bitmap, context, canvas } = nativeMocks();
    const original = new Blob(['fictional'], { type: 'image/png' });
    expect((await encodeJpeg(original)).type).toBe('image/jpeg');
    expect(createImageBitmap).toHaveBeenCalledWith(original, {
      imageOrientation: 'from-image',
    });
    expect(context.fillStyle).toBe('#ffffff');
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 432, 765);
    expect(context.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(context.fillRect.mock.invocationCallOrder[0]).toBeLessThan(
      context.drawImage.mock.invocationCallOrder[0],
    );
    expect(canvas.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      'image/jpeg',
      0.95,
    );
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });
  it('releases resources when encoding fails', async () => {
    const { bitmap, canvas } = nativeMocks();
    canvas.toBlob.mockImplementation((callback) => callback(null));
    await expect(encodeJpeg(new Blob(['fictional']))).rejects.toThrow();
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
  });
  it('releases resources when the canvas context is unavailable', async () => {
    const { bitmap, canvas } = nativeMocks();
    canvas.getContext.mockReturnValue(null as never);
    await expect(encodeJpeg(new Blob(['fictional']))).rejects.toThrow();
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
  it('uses image-element fallback and revokes its decoding URL', async () => {
    const { context } = nativeMocks();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockRejectedValue(new Error('Unsupported format')),
    );
    const revoke = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fictional-decode');
    class FakeImage {
      naturalWidth = 320;
      naturalHeight = 240;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        if (value) this.onload?.();
      }
    }
    vi.stubGlobal('Image', FakeImage);
    await encodeJpeg(new Blob(['fictional'], { type: 'image/webp' }));
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 320, 240);
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:fictional-decode');
  });
  it('revokes decoding URLs after image-element decode failure', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    const revoke = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fictional-decode');
    class BadImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        if (value) this.onerror?.();
      }
    }
    vi.stubGlobal('Image', BadImage);
    await expect(encodeJpeg(new Blob(['fictional']))).rejects.toThrow();
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:fictional-decode');
  });
});
