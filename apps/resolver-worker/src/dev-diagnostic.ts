import { createWorker, type Env } from './index';
import type { DiagnosticRecord } from './diagnostics';
import { inspectMediaStructure } from './dev-structure';
/** Local internal entry point only: not imported by the production Worker. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(
        new URL(request.url).hostname,
      )
    )
      return new Response(null, {
        status: 404,
        headers: { 'Cache-Control': 'no-store' },
      });
    const diagnostics: DiagnosticRecord[] = [];
    let structure: ReturnType<typeof inspectMediaStructure> | undefined;
    const response = await createWorker(
      fetch,
      (record) => diagnostics.push(record),
      (raw) => {
        structure = inspectMediaStructure(raw);
      },
    ).fetch(request, env);
    if (
      request.method !== 'POST' ||
      new URL(request.url).pathname !== '/api/resolve'
    )
      return response;
    const body: unknown = await response.json();
    // Return only a safe typed outcome plus allowlisted observations, never normalized content.
    const outcome = body as {
      ok: boolean;
      error?: { code: string; message: string };
      result?: { post: { assets: { type: 'image' | 'video' }[] } };
    };
    return new Response(
      JSON.stringify({
        ok: outcome.ok,
        ...(outcome.error ? { error: outcome.error } : {}),
        diagnostics,
        ...(structure ? { structure } : {}),
        ...(outcome.ok && outcome.result
          ? {
              assetCount: outcome.result.post.assets.length,
              assetTypes: outcome.result.post.assets.map((asset) => asset.type),
            }
          : {}),
      }),
      { status: response.status, headers: response.headers },
    );
  },
};
