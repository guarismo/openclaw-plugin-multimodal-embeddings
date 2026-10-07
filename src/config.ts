export type Modality = "image" | "audio";
export type MediaFormat = "content-parts";
export type Preset = "none" | "embeddinggemma";

export type ModelSettings = {
  modalities: Modality[];
  mediaFormat: MediaFormat;
  queryPrefix: string;
  documentPrefix: string;
  mediaLabel: "include" | "omit";
  dimensions?: number;
};

export type PluginSettings = {
  models: Record<string, Partial<RawModelSettings>>;
  convertMedia: boolean;
  ffmpegPath: string;
  batchSize: number;
};

type RawModelSettings = {
  modalities: unknown;
  mediaFormat: unknown;
  preset: unknown;
  queryPrefix: unknown;
  documentPrefix: unknown;
  mediaLabel: unknown;
  dimensions: unknown;
};

// EmbeddingGemma (1 and 2) is trained with asymmetric task prefixes; without them short
// generic chunks win too many queries (openclaw/openclaw#140932).
const PRESETS: Record<Preset, { query: string; document: string }> = {
  none: { query: "", document: "" },
  embeddinggemma: { query: "task: search result | query: ", document: "title: none | text: " },
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

export function parsePluginSettings(raw: unknown): PluginSettings {
  const cfg = asRecord(raw);
  const batchSize = typeof cfg.batchSize === "number" && cfg.batchSize >= 1 ? Math.min(256, Math.floor(cfg.batchSize)) : 32;
  return {
    models: asRecord(cfg.models) as Record<string, Partial<RawModelSettings>>,
    convertMedia: cfg.convertMedia !== false,
    ffmpegPath: typeof cfg.ffmpegPath === "string" && cfg.ffmpegPath.trim() ? cfg.ffmpegPath.trim() : "ffmpeg",
    batchSize,
  };
}

/** Settings for one model: its own entry, else the "*" entry, else text-only defaults. */
export function resolveModelSettings(settings: PluginSettings, model: string): ModelSettings {
  const raw = asRecord(settings.models[model] ?? settings.models["*"]);
  const modalities = Array.isArray(raw.modalities)
    ? [...new Set(raw.modalities.filter((m): m is Modality => m === "image" || m === "audio"))]
    : [];
  const preset: Preset =
    raw.preset === "none" || raw.preset === "embeddinggemma"
      ? raw.preset
      : /embeddinggemma/i.test(model)
        ? "embeddinggemma"
        : "none";
  return {
    modalities,
    mediaFormat: "content-parts",
    queryPrefix: typeof raw.queryPrefix === "string" ? raw.queryPrefix : PRESETS[preset].query,
    documentPrefix: typeof raw.documentPrefix === "string" ? raw.documentPrefix : PRESETS[preset].document,
    mediaLabel: raw.mediaLabel === "omit" ? "omit" : "include",
    dimensions: typeof raw.dimensions === "number" && raw.dimensions >= 1 ? Math.floor(raw.dimensions) : undefined,
  };
}
