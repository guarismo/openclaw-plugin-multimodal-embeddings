import { describe, expect, it } from "vitest";
import { parsePluginSettings, resolveModelSettings } from "./config.js";

const QP = "task: search result | query: ";
const DP = "title: none | text: ";

describe("parsePluginSettings", () => {
  it("applies defaults for missing or non-object input", () => {
    for (const raw of [undefined, null, "x", 5, [], {}]) {
      expect(parsePluginSettings(raw)).toEqual({ models: {}, convertMedia: true, ffmpegPath: "ffmpeg", batchSize: 32, mediaSearchToolMode: "direct" });
    }
  });

  it("keeps the media search tool direct unless catalog is chosen", () => {
    expect(parsePluginSettings({ mediaSearchToolMode: "catalog" }).mediaSearchToolMode).toBe("catalog");
    for (const v of ["direct", "other", undefined, 1]) {
      expect(parsePluginSettings({ mediaSearchToolMode: v }).mediaSearchToolMode).toBe("direct");
    }
  });

  it("only disables convertMedia on an explicit false", () => {
    expect(parsePluginSettings({ convertMedia: false }).convertMedia).toBe(false);
    expect(parsePluginSettings({ convertMedia: "false" }).convertMedia).toBe(true);
    expect(parsePluginSettings({ convertMedia: 0 }).convertMedia).toBe(true);
  });

  it("trims ffmpegPath and ignores bad values", () => {
    expect(parsePluginSettings({ ffmpegPath: "  /usr/bin/ffmpeg " }).ffmpegPath).toBe("/usr/bin/ffmpeg");
    expect(parsePluginSettings({ ffmpegPath: "   " }).ffmpegPath).toBe("ffmpeg");
    expect(parsePluginSettings({ ffmpegPath: 7 }).ffmpegPath).toBe("ffmpeg");
  });

  it("clamps batchSize to 1..256 and floors fractions", () => {
    expect(parsePluginSettings({ batchSize: 10 }).batchSize).toBe(10);
    expect(parsePluginSettings({ batchSize: 1 }).batchSize).toBe(1);
    expect(parsePluginSettings({ batchSize: 1000 }).batchSize).toBe(256);
    expect(parsePluginSettings({ batchSize: 12.9 }).batchSize).toBe(12);
    expect(parsePluginSettings({ batchSize: 1.5 }).batchSize).toBe(1);
  });

  it("falls back to 32 for out-of-range or non-number batchSize", () => {
    for (const v of [0, -5, 0.5, NaN, "64", null, {}]) {
      expect(parsePluginSettings({ batchSize: v }).batchSize).toBe(32);
    }
  });

  it("ignores a non-object models value", () => {
    expect(parsePluginSettings({ models: [] }).models).toEqual({});
    expect(parsePluginSettings({ models: "x" }).models).toEqual({});
    expect(parsePluginSettings({ models: { a: {} } }).models).toEqual({ a: {} });
  });
});

describe("resolveModelSettings", () => {
  const s = (models: Record<string, unknown>) => parsePluginSettings({ models });

  it("returns text-only defaults when there is no entry", () => {
    expect(resolveModelSettings(s({}), "bge-m3")).toEqual({
      modalities: [],
      mediaFormat: "content-parts",
      queryPrefix: "",
      documentPrefix: "",
      mediaLabel: "include",
      dimensions: undefined,
    });
  });

  it("uses the exact model entry", () => {
    const r = resolveModelSettings(s({ m: { modalities: ["image"] } }), "m");
    expect(r.modalities).toEqual(["image"]);
  });

  it("falls back to the * entry and prefers the exact entry over it", () => {
    const settings = s({ "*": { modalities: ["audio"] }, m: { modalities: ["image"] } });
    expect(resolveModelSettings(settings, "other").modalities).toEqual(["audio"]);
    expect(resolveModelSettings(settings, "m").modalities).toEqual(["image"]);
  });

  it("does not merge the * entry into an exact entry", () => {
    const settings = s({ "*": { modalities: ["audio"], mediaLabel: "omit" }, m: {} });
    const r = resolveModelSettings(settings, "m");
    expect(r.modalities).toEqual([]);
    expect(r.mediaLabel).toBe("include");
  });

  it("auto-detects the embeddinggemma preset by name, case-insensitively", () => {
    for (const name of ["embeddinggemma-2", "EmbeddingGemma-300m", "ggml-org/EMBEDDINGGEMMA-2-GGUF"]) {
      const r = resolveModelSettings(s({}), name);
      expect(r.queryPrefix).toBe(QP);
      expect(r.documentPrefix).toBe(DP);
    }
  });

  it("applies the auto preset even when an entry exists without a preset", () => {
    const r = resolveModelSettings(s({ "embeddinggemma-2": { modalities: ["image"] } }), "embeddinggemma-2");
    expect(r.queryPrefix).toBe(QP);
    expect(r.documentPrefix).toBe(DP);
  });

  it("explicit preset none overrides auto-detect", () => {
    const r = resolveModelSettings(s({ "embeddinggemma-2": { preset: "none" } }), "embeddinggemma-2");
    expect(r.queryPrefix).toBe("");
    expect(r.documentPrefix).toBe("");
  });

  it("explicit preset embeddinggemma applies to any model name", () => {
    const r = resolveModelSettings(s({ foo: { preset: "embeddinggemma" } }), "foo");
    expect(r.queryPrefix).toBe(QP);
    expect(r.documentPrefix).toBe(DP);
  });

  it("ignores an invalid preset and auto-detects", () => {
    expect(resolveModelSettings(s({ embeddinggemma: { preset: "bogus" } }), "embeddinggemma").queryPrefix).toBe(QP);
    expect(resolveModelSettings(s({ foo: { preset: "bogus" } }), "foo").queryPrefix).toBe("");
  });

  it("queryPrefix and documentPrefix override the preset independently", () => {
    const r = resolveModelSettings(s({ embeddinggemma: { queryPrefix: "Q: " } }), "embeddinggemma");
    expect(r.queryPrefix).toBe("Q: ");
    expect(r.documentPrefix).toBe(DP);
    const r2 = resolveModelSettings(s({ embeddinggemma: { documentPrefix: "" } }), "embeddinggemma");
    expect(r2.documentPrefix).toBe("");
    expect(r2.queryPrefix).toBe(QP);
  });

  it("ignores non-string prefixes", () => {
    const r = resolveModelSettings(s({ foo: { queryPrefix: 1, documentPrefix: null } }), "foo");
    expect(r.queryPrefix).toBe("");
    expect(r.documentPrefix).toBe("");
  });

  it("filters invalid modalities and dedupes", () => {
    const r = resolveModelSettings(s({ m: { modalities: ["image", "video", "audio", "image", 3, null] } }), "m");
    expect(r.modalities).toEqual(["image", "audio"]);
  });

  it("treats a non-array modalities as empty", () => {
    expect(resolveModelSettings(s({ m: { modalities: "image" } }), "m").modalities).toEqual([]);
  });

  it("mediaLabel is omit only when set to omit", () => {
    expect(resolveModelSettings(s({ m: { mediaLabel: "omit" } }), "m").mediaLabel).toBe("omit");
    expect(resolveModelSettings(s({ m: { mediaLabel: "include" } }), "m").mediaLabel).toBe("include");
    expect(resolveModelSettings(s({ m: { mediaLabel: "bogus" } }), "m").mediaLabel).toBe("include");
  });

  it("parses dimensions as a positive integer", () => {
    expect(resolveModelSettings(s({ m: { dimensions: 768 } }), "m").dimensions).toBe(768);
    expect(resolveModelSettings(s({ m: { dimensions: 768.9 } }), "m").dimensions).toBe(768);
    for (const v of [0, -1, "768", null]) {
      expect(resolveModelSettings(s({ m: { dimensions: v } }), "m").dimensions).toBeUndefined();
    }
  });

  it("treats dimensions below 1 as unset", () => {
    expect(resolveModelSettings(s({ m: { dimensions: 0.5 } }), "m").dimensions).toBeUndefined();
  });
});
