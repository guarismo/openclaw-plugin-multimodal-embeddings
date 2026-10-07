import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import {
  fetchRemoteEmbeddingVectors,
  resolveEmbeddingEndpointUrl,
  resolveRemoteEmbeddingClient,
  sanitizeEmbeddingCacheHeaders,
} from "openclaw/plugin-sdk/memory-core-host-engine-embeddings";
import { parsePluginSettings, resolveModelSettings, type PluginSettings } from "./config.js";
import { prepareMedia } from "./media.js";
import { buildRequestInput, checkVectors, mediaParts, type EmbeddingInput, type Role } from "./request.js";

const PLUGIN_ID = "multimodal-embeddings";
const PROVIDER_ID = "multimodal-embeddings";
const DEFAULT_BASE_URL = "http://127.0.0.1:8080/v1";

type CallOptions = { signal?: AbortSignal; inputType?: string };
type CreateOptions = { model: string; config: unknown; remote?: { baseUrl?: string } };

const normalizeModel = (model: string) => model.trim();

function createProvider(settings: PluginSettings) {
  return async (options: CreateOptions) => {
    const model = normalizeModel(options.model);
    if (!model) throw new Error(`${PROVIDER_ID}: set memory.search.model to the model id your server serves`);
    const client = await resolveRemoteEmbeddingClient({
      provider: PROVIDER_ID,
      options,
      defaultBaseUrl: DEFAULT_BASE_URL,
      normalizeModel,
    });
    const modelSettings = resolveModelSettings(settings, model);
    const url = resolveEmbeddingEndpointUrl(client.baseUrl, "embeddings");

    const embedMany = async (inputs: EmbeddingInput[], role: Role, signal?: AbortSignal): Promise<number[][]> => {
      const out: number[][] = [];
      for (let i = 0; i < inputs.length; i += settings.batchSize) {
        const slice = inputs.slice(i, i + settings.batchSize);
        const body = await Promise.all(
          slice.map(async (input) => {
            const media = await Promise.all(mediaParts(input).map((part) => prepareMedia(part, settings)));
            return buildRequestInput(input, role, modelSettings, media);
          }),
        );
        const vectors = await fetchRemoteEmbeddingVectors({
          url,
          headers: client.headers,
          ssrfPolicy: client.ssrfPolicy,
          signal,
          body: { model: client.model, input: body },
          errorPrefix: `${PROVIDER_ID} embeddings`,
        });
        out.push(...checkVectors(vectors, slice.length, modelSettings.dimensions));
      }
      return out;
    };

    const roleOf = (callOptions?: CallOptions): Role => (callOptions?.inputType === "query" ? "query" : "document");

    return {
      provider: {
        id: PROVIDER_ID,
        model: client.model,
        ...(modelSettings.dimensions ? { dimensions: modelSettings.dimensions } : {}),
        embed: async (input: EmbeddingInput, callOptions?: CallOptions) =>
          (await embedMany([input], roleOf(callOptions), callOptions?.signal))[0] ?? [],
        embedBatch: async (inputs: EmbeddingInput[], callOptions?: CallOptions) =>
          await embedMany(inputs, roleOf(callOptions), callOptions?.signal),
      },
      runtime: {
        id: PROVIDER_ID,
        // Anything that changes the vectors belongs here, so a change makes memory ask for a reindex.
        cacheKeyData: {
          provider: PROVIDER_ID,
          baseUrl: client.baseUrl,
          model: client.model,
          queryPrefix: modelSettings.queryPrefix,
          documentPrefix: modelSettings.documentPrefix,
          mediaLabel: modelSettings.mediaLabel,
          mediaFormat: modelSettings.mediaFormat,
          dimensions: modelSettings.dimensions ?? null,
          headers: sanitizeEmbeddingCacheHeaders(client.headers, ["authorization"]),
        },
      },
    };
  };
}

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "Multimodal Embeddings (OpenAI-compatible)",
  description:
    "Memory embedding provider for OpenAI-compatible /v1/embeddings servers, with image and audio indexing for multimodal models.",
  register(api) {
    const settings = parsePluginSettings(api.pluginConfig);
    const adapter = {
      id: PROVIDER_ID,
      transport: "remote" as const,
      normalizeModel: (options: { model: string }) => normalizeModel(options.model),
      // memory-core only allows memory.search.multimodal when this returns true for the model.
      supportsMultimodalEmbeddings: ({ model }: { model: string }) =>
        resolveModelSettings(settings, normalizeModel(model)).modalities.length > 0,
      create: createProvider(settings),
    };
    api.registerEmbeddingProvider(adapter as unknown as Parameters<typeof api.registerEmbeddingProvider>[0]);
  },
});
