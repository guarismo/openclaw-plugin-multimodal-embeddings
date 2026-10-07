import { existsSync } from "node:fs";
import path from "node:path";
import { resolveMemorySearchConfig, resolveAgentWorkspaceDir } from "openclaw/plugin-sdk/memory-core-host-engine-foundation";
import { cosineSimilarity, decodeMemoryEmbedding, openOpenClawAgentDatabaseReadOnly } from "openclaw/plugin-sdk/memory-core-host-engine-knn";
import { MEMORY_INDEX_CHUNKS_TABLE } from "openclaw/plugin-sdk/memory-core-host-engine-storage";

export const TOOL_NAME = "multimodal_media_search";

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|heic|heif)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|opus|m4a|m2a|aac|flac)$/i;

export type MediaKind = "image" | "audio";
export type MediaHit = { path: string; kind: MediaKind; score: number };

export const kindOf = (p: string): MediaKind | undefined =>
  IMAGE_EXT.test(p) ? "image" : AUDIO_EXT.test(p) ? "audio" : undefined;

/** Rank media vectors against a query vector. Pure, so it is unit-testable. */
export function rankMedia(
  query: number[],
  rows: Array<{ path: string; embedding: number[] }>,
  opts: { kind?: MediaKind; maxResults: number },
): { hits: MediaHit[]; median: number; searched: number } {
  const scored: MediaHit[] = [];
  for (const row of rows) {
    const kind = kindOf(row.path);
    if (!kind || (opts.kind && kind !== opts.kind) || row.embedding.length === 0) continue;
    scored.push({ path: row.path, kind, score: cosineSimilarity(query, row.embedding) });
  }
  scored.sort((a, b) => b.score - a.score);
  const median = scored.length ? scored[Math.floor(scored.length / 2)].score : 0;
  return { hits: scored.slice(0, opts.maxResults), median, searched: scored.length };
}

type MemorySearchSettings = {
  provider?: string;
  model?: string;
  remote?: unknown;
};

type ToolContext = {
  agentId?: string;
  config?: unknown;
  getRuntimeConfig?: () => unknown;
};

type Embedder = (settings: MemorySearchSettings, config: unknown, query: string) => Promise<number[]>;

/** Media vectors memory-core already stored for this agent (one chunk per media file). */
function readMediaRows(agentId: string, model: string) {
  const opened = openOpenClawAgentDatabaseReadOnly({ agentId });
  if (!opened.found) return [];
  try {
    const rows = opened.database.db
      .prepare(`SELECT path, embedding FROM ${MEMORY_INDEX_CHUNKS_TABLE} WHERE source = 'memory' AND model = ?`)
      .all(model) as Array<{ path: string; embedding: Uint8Array }>;
    return rows
      .filter((r) => kindOf(r.path))
      .map((r) => ({ path: r.path, embedding: decodeMemoryEmbedding(r.embedding) }));
  } finally {
    opened.database.close();
  }
}

export function createMediaSearchTool(ctx: ToolContext, providerId: string, embed: Embedder, direct = true) {
  return {
    name: TOOL_NAME,
    // Visible without a tool_search round-trip; small local models answer one step sooner.
    ...(direct ? { catalogMode: "direct-only" as const } : {}),
    description:
      "Find photos, images, screenshots, voice notes and audio recordings in your memory by describing what they show or say " +
      "(e.g. 'burger on a kitchen scale', 'voice note about a pasta recipe'). Searches only media files, so text notes never " +
      "crowd them out. Returns workspace paths you can attach. Scores are relative: compare the top score with the median.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", description: "Describe the content of the photo or recording." },
        description: { type: "string", description: "Same as query; use either one." },
        kind: { type: "string", enum: ["image", "audio", "any"], description: "Limit to images or audio. Default any." },
        maxResults: { type: "integer", minimum: 1, maximum: 10, description: "Default 3." },
      },
    },
    async execute(_id: string, params: { query?: string; description?: string; kind?: string; maxResults?: number }) {
      const fail = (text: string) => ({ content: [{ type: "text", text }], details: { error: text } });
      // Small models often name the field after what they are passing; accept that too.
      const query = (params.query ?? params.description ?? "").trim();
      if (!query) return fail('pass the description of the photo or recording in "query", e.g. {"query": "pizza on a plate"}');
      const agentId = ctx.agentId;
      const config = ctx.getRuntimeConfig?.() ?? ctx.config;
      if (!agentId || !config) return fail("no agent context; this tool runs inside an agent turn");

      const settings = resolveMemorySearchConfig(config, agentId) as MemorySearchSettings | null;
      if (!settings) return fail("memory search is disabled for this agent");
      if (settings.provider !== providerId || !settings.model) {
        return fail(`memory search for this agent does not use the ${providerId} provider, so its media vectors are not searchable here`);
      }

      const rows = readMediaRows(agentId, settings.model);
      if (rows.length === 0) {
        return fail("no indexed photos or recordings yet; add a media folder to memory.search.extraPaths with multimodal enabled");
      }
      const kind = params.kind === "image" || params.kind === "audio" ? params.kind : undefined;
      const maxResults = Math.min(10, Math.max(1, Math.floor(params.maxResults ?? 3)));
      const queryVector = await embed(settings, config, query);
      const ranked = rankMedia(queryVector, rows, { kind, maxResults });

      // Files deleted since the last sync are dropped rather than offered as attachments.
      const workspace = resolveAgentWorkspaceDir(config, agentId);
      const hits = ranked.hits.filter((h) => existsSync(path.isAbsolute(h.path) ? h.path : path.join(workspace, h.path)));
      const details = {
        query,
        searched: ranked.searched,
        median: Number(ranked.median.toFixed(3)),
        results: hits.map((h) => ({ ...h, score: Number(h.score.toFixed(3)) })),
      };
      const lines = hits.map((h, i) => `${i + 1}. ${h.path} (${h.kind}, score ${h.score.toFixed(3)})`);
      const text =
        hits.length === 0
          ? `No matching ${kind ?? "media"} found among ${ranked.searched} files.`
          : `Searched ${ranked.searched} media files (median score ${ranked.median.toFixed(3)}; a good match is clearly above it):\n${lines.join("\n")}\n` +
            "To show a result to the user, attach the file using its path exactly as listed; describing it is not enough.";
      return { content: [{ type: "text", text }], details };
    },
  };
}
