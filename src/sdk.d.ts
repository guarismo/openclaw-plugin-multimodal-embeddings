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

declare module "openclaw/plugin-sdk/memory-core-host-engine-foundation" {
  export function resolveMemorySearchConfig(config: unknown, agentId: string): unknown;
  export function resolveAgentWorkspaceDir(config: unknown, agentId: string): string;
}

declare module "openclaw/plugin-sdk/memory-core-host-engine-knn" {
  export function cosineSimilarity(a: number[], b: number[]): number;
  export function decodeMemoryEmbedding(bytes: Uint8Array): number[];
  export function openOpenClawAgentDatabaseReadOnly(options: { agentId: string }):
    | { found: false; reason: string }
    | {
        found: true;
        database: {
          db: { prepare(sql: string): { all(...params: unknown[]): unknown[] } };
          close(): void;
        };
      };
}

declare module "openclaw/plugin-sdk/memory-core-host-engine-storage" {
  export const MEMORY_INDEX_CHUNKS_TABLE: string;
}
