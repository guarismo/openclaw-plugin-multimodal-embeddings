import type { MediaFormat, ModelSettings } from "./config.js";

/** The structured input memory-core hands to embedding providers. */
export type EmbeddingInput =
  | string
  | {
      text: string;
      parts?: Array<{ type: "text"; text: string } | { type: "inline-data"; mimeType: string; data: string }>;
    };

export type Role = "query" | "document";

/** One media payload after any conversion, ready to be placed in a request. */
export type PreparedMedia = { mimeType: string; data: string };

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "input_audio"; input_audio: { data: string; format: string } };

export type RequestInput = string | { content: ContentPart[] };

export const inputText = (input: EmbeddingInput): string => (typeof input === "string" ? input : input.text);

export const mediaParts = (input: EmbeddingInput) =>
  typeof input === "string" ? [] : (input.parts ?? []).filter((p) => p.type === "inline-data");

const AUDIO_FORMATS: Record<string, string> = {
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/vnd.wave": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
};

/** Formats the server can take as-is; anything else must be converted first. */
export function isNativeMedia(mimeType: string): boolean {
  const mime = mimeType.toLowerCase();
  return mime === "image/jpeg" || mime === "image/png" || mime in AUDIO_FORMATS;
}

export function modalityOf(mimeType: string): "image" | "audio" | undefined {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  return undefined;
}

/**
 * Build one request input. Text gets the role's prefix; media becomes llama.cpp /
 * OpenRouter content parts. `media` must hold the input's inline-data parts in order,
 * already converted to native formats.
 */
export function buildRequestInput(
  input: EmbeddingInput,
  role: Role,
  model: ModelSettings,
  media: PreparedMedia[],
): RequestInput {
  const prefix = role === "query" ? model.queryPrefix : model.documentPrefix;
  if (media.length === 0) return prefix + inputText(input);

  const content: ContentPart[] = [];
  if (model.mediaLabel === "include") {
    const label = inputText(input).trim();
    if (label) content.push({ type: "text", text: prefix + label });
  }
  for (const m of media) {
    const mime = m.mimeType.toLowerCase();
    if (mime.startsWith("image/")) {
      content.push({ type: "image_url", image_url: { url: `data:${mime};base64,${m.data}` } });
    } else if (AUDIO_FORMATS[mime]) {
      content.push({ type: "input_audio", input_audio: { data: m.data, format: AUDIO_FORMATS[mime] } });
    } else {
      throw new Error(`multimodal-embeddings: unsupported media type ${m.mimeType} after conversion`);
    }
  }
  return { content };
}

/**
 * Which inputs go in one batched `input` request and which need a request of their own.
 * content-parts (llama.cpp, OpenRouter): everything is batched.
 * chat-messages (vLLM): each input with media is sent alone as a chat `messages` request;
 * plain text stays batched.
 */
export function planRequests(inputs: EmbeddingInput[], format: MediaFormat): { batched: number[]; single: number[] } {
  const batched: number[] = [];
  const single: number[] = [];
  inputs.forEach((input, i) => (format === "chat-messages" && mediaParts(input).length > 0 ? single : batched).push(i));
  return { batched, single };
}

/** vLLM-style body for one media input: the content parts become a single user message. */
export function chatMessagesBody(model: string, request: RequestInput) {
  const content = typeof request === "string" ? [{ type: "text" as const, text: request }] : request.content;
  return { model, messages: [{ role: "user", content }] };
}

export function checkVectors(vectors: number[][], expected: number, dimensions?: number): number[][] {
  if (vectors.length !== expected) {
    throw new Error(`multimodal-embeddings: server returned ${vectors.length} vectors for ${expected} inputs`);
  }
  if (dimensions !== undefined) {
    const bad = vectors.find((v) => v.length !== dimensions);
    if (bad) throw new Error(`multimodal-embeddings: expected ${dimensions} dimensions, got ${bad.length}`);
  }
  return vectors;
}
