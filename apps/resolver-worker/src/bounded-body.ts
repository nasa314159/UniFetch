import { UniFetchError, type ErrorCode } from '@unifetch/core';
/** Read incrementally rather than buffering an unbounded caller/upstream body. */
export async function boundedBody(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
  code: ErrorCode,
): Promise<Uint8Array> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new UniFetchError(
          code,
          'The request or upstream response exceeds the supported size.',
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
