// This SDK subpath ships JavaScript only; these declarations cover the helpers this plugin
// uses, matching openclaw 2026.9.8.
declare module "openclaw/plugin-sdk/memory-core-host-engine-embeddings" {
  export type RemoteEmbeddingClient = {
    baseUrl: string;
    headers: Record<string, string>;
    ssrfPolicy: unknown;
    model: string;
  };
  export function resolveRemoteEmbeddingClient(params: {
    provider: string;
    capability?: string;
    options: unknown;
    defaultBaseUrl: string;
    normalizeModel: (model: string) => string;
  }): Promise<RemoteEmbeddingClient>;
  export function resolveEmbeddingEndpointUrl(baseUrl: string, endpoint: string): string;
  export function fetchRemoteEmbeddingVectors(params: {
    url: string;
    headers: Record<string, string>;
    ssrfPolicy: unknown;
    signal?: AbortSignal;
    body: { model: string; input: unknown[] } & Record<string, unknown>;
    errorPrefix?: string;
  }): Promise<number[][]>;
  export function sanitizeEmbeddingCacheHeaders(
    headers: Record<string, string>,
    excludedHeaderNames: string[],
  ): Array<[string, string]>;
}
