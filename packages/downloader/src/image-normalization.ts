export interface NormalizedImage {
  blob: Blob;
  converted: boolean;
  fallback: boolean;
}
export type JpegEncoder = (blob: Blob) => Promise<Blob>;

async function decodedImage(blob: Blob): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  release(): void;
}> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, {
        imageOrientation: 'from-image',
      });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Some supported browsers decode particular formats only through an image element.
    }
  }
  const url = URL.createObjectURL(blob);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Image decoding failed'));
      image.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => {
        image.onload = null;
        image.onerror = null;
        image.src = '';
        URL.revokeObjectURL(url);
      },
    };
  } catch (error) {
    image.onload = null;
    image.onerror = null;
    image.src = '';
    URL.revokeObjectURL(url);
    throw error;
  }
}

/** Native decoding preserves rendered orientation. Alpha is deterministically composited on white. */
export async function encodeJpeg(blob: Blob): Promise<Blob> {
  const decoded = await decodedImage(blob);
  let canvas: HTMLCanvasElement | undefined;
  try {
    if (!decoded.width || !decoded.height)
      throw new Error('Invalid image dimensions');
    canvas = document.createElement('canvas');
    canvas.width = decoded.width;
    canvas.height = decoded.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, decoded.width, decoded.height);
    context.drawImage(decoded.source, 0, 0);
    const output = await new Promise<Blob>((resolve, reject) => {
      canvas!.toBlob(
        (result) =>
          result ? resolve(result) : reject(new Error('JPEG encoding failed')),
        'image/jpeg',
        0.95,
      );
    });
    if (output.type !== 'image/jpeg' || !output.size)
      throw new Error('JPEG encoding unavailable');
    return output;
  } finally {
    decoded.release();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

export async function normalizeStillImage(
  blob: Blob,
  encode: JpegEncoder = encodeJpeg,
): Promise<NormalizedImage> {
  if (blob.type.toLowerCase() === 'image/jpeg')
    return { blob, converted: false, fallback: false };
  try {
    const output = await encode(blob);
    if (output.type !== 'image/jpeg' || !output.size)
      throw new Error('Invalid JPEG output');
    return { blob: output, converted: true, fallback: false };
  } catch {
    // Keep original bytes and their real MIME; never disguise a failed conversion as JPEG.
    return { blob, converted: false, fallback: true };
  }
}
