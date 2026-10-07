import { describe, expect, it } from "vitest";
import type { ModelSettings } from "./config.js";
import {
  buildRequestInput,
  checkVectors,
  inputText,
  isNativeMedia,
  mediaParts,
  modalityOf,
  type EmbeddingInput,
} from "./request.js";

const model = (over: Partial<ModelSettings> = {}): ModelSettings => ({
  modalities: ["image", "audio"],
  mediaFormat: "content-parts",
  queryPrefix: "Q: ",
  documentPrefix: "D: ",
  mediaLabel: "include",
  ...over,
});

const imageInput = (text = "Image file: a.png"): EmbeddingInput => ({
  text,
  parts: [
    { type: "text", text },
    { type: "inline-data", mimeType: "image/png", data: "QUJD" },
  ],
});

describe("buildRequestInput text", () => {
  it("prefixes plain strings by role", () => {
    expect(buildRequestInput("hi", "query", model(), [])).toBe("Q: hi");
    expect(buildRequestInput("hi", "document", model(), [])).toBe("D: hi");
  });

  it("prefixes text-only objects by role and returns a string", () => {
    const input: EmbeddingInput = { text: "hello", parts: [{ type: "text", text: "hello" }] };
    expect(buildRequestInput(input, "query", model(), [])).toBe("Q: hello");
    expect(buildRequestInput(input, "document", model(), [])).toBe("D: hello");
    expect(buildRequestInput({ text: "x" }, "document", model(), [])).toBe("D: x");
  });

  it("does not trim text-only input", () => {
    expect(buildRequestInput("  hi ", "document", model(), [])).toBe("D:   hi ");
  });
});

describe("buildRequestInput media", () => {
  const png = [{ mimeType: "image/png", data: "QUJD" }];

  it("puts the prefixed, trimmed label first when mediaLabel is include", () => {
    expect(buildRequestInput(imageInput("  Image file: a.png \n"), "document", model(), png)).toEqual({
      content: [
        { type: "text", text: "D: Image file: a.png" },
        { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } },
      ],
    });
  });

  it("uses the query prefix for the label in query role", () => {
    const r = buildRequestInput(imageInput(), "query", model(), png) as { content: { text?: string }[] };
    expect(r.content[0]?.text).toBe("Q: Image file: a.png");
  });

  it("sends no text part when mediaLabel is omit", () => {
    expect(buildRequestInput(imageInput(), "document", model({ mediaLabel: "omit" }), png)).toEqual({
      content: [{ type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } }],
    });
  });

  it("sends no text part when the label is empty or whitespace", () => {
    for (const t of ["", "   \n"]) {
      expect(buildRequestInput(imageInput(t), "document", model(), png)).toEqual({
        content: [{ type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } }],
      });
    }
  });

  it("lowercases the mime type in the data URI", () => {
    const r = buildRequestInput("", "document", model(), [{ mimeType: "IMAGE/JPEG", data: "AA==" }]);
    expect(r).toEqual({ content: [{ type: "image_url", image_url: { url: "data:image/jpeg;base64,AA==" } }] });
  });

  it("maps wav variants to format wav and mpeg/mp3 to format mp3", () => {
    const fmt = (mimeType: string) => {
      const r = buildRequestInput("", "document", model(), [{ mimeType, data: "AA==" }]) as {
        content: { input_audio: { data: string; format: string } }[];
      };
      return r.content[0]?.input_audio;
    };
    for (const m of ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave", "AUDIO/WAV"]) {
      expect(fmt(m)).toEqual({ data: "AA==", format: "wav" });
    }
    for (const m of ["audio/mpeg", "audio/mp3", "Audio/MPEG"]) {
      expect(fmt(m)).toEqual({ data: "AA==", format: "mp3" });
    }
  });

  it("keeps media order after the label", () => {
    const r = buildRequestInput("L", "document", model(), [
      { mimeType: "image/jpeg", data: "A" },
      { mimeType: "audio/wav", data: "B" },
    ]) as { content: { type: string }[] };
    expect(r.content.map((c) => c.type)).toEqual(["text", "image_url", "input_audio"]);
  });

  it("throws for unsupported mime types", () => {
    expect(() => buildRequestInput("x", "document", model(), [{ mimeType: "audio/ogg", data: "A" }])).toThrow(
      /unsupported media type audio\/ogg/,
    );
    expect(() => buildRequestInput("x", "document", model(), [{ mimeType: "video/mp4", data: "A" }])).toThrow(
      /unsupported/,
    );
  });

  // POSSIBLE BUG: any image/* mime is accepted here, including formats the server cannot decode
  // (e.g. image/webp). Only prepareMedia guards native formats; this function relies on callers
  // having converted first. Documenting current behaviour.
  it("accepts image/webp without complaint (no native check here)", () => {
    const r = buildRequestInput("", "document", model(), [{ mimeType: "image/webp", data: "A" }]);
    expect(r).toEqual({ content: [{ type: "image_url", image_url: { url: "data:image/webp;base64,A" } }] });
  });
});

describe("isNativeMedia", () => {
  it("accepts jpeg, png, wav variants and mpeg, case-insensitively", () => {
    for (const m of [
      "image/jpeg",
      "image/png",
      "IMAGE/PNG",
      "audio/wav",
      "audio/x-wav",
      "audio/wave",
      "audio/vnd.wave",
      "audio/mpeg",
      "audio/mp3",
    ]) {
      expect(isNativeMedia(m), m).toBe(true);
    }
  });

  it("rejects everything else", () => {
    for (const m of ["image/webp", "image/gif", "image/heic", "image/jpg", "audio/ogg", "audio/flac", "audio/mp4", "text/plain", ""]) {
      expect(isNativeMedia(m), m).toBe(false);
    }
  });
});

describe("modalityOf", () => {
  it("classifies by mime prefix", () => {
    expect(modalityOf("image/webp")).toBe("image");
    expect(modalityOf("IMAGE/PNG")).toBe("image");
    expect(modalityOf("audio/ogg")).toBe("audio");
    expect(modalityOf("video/mp4")).toBeUndefined();
    expect(modalityOf("application/pdf")).toBeUndefined();
    expect(modalityOf("")).toBeUndefined();
  });
});

describe("mediaParts and inputText", () => {
  it("mediaParts is empty for strings and inputs without parts", () => {
    expect(mediaParts("x")).toEqual([]);
    expect(mediaParts({ text: "x" })).toEqual([]);
    expect(mediaParts({ text: "x", parts: [{ type: "text", text: "x" }] })).toEqual([]);
  });

  it("mediaParts returns only inline-data parts in order", () => {
    const a = { type: "inline-data" as const, mimeType: "image/png", data: "A" };
    const b = { type: "inline-data" as const, mimeType: "audio/wav", data: "B" };
    expect(mediaParts({ text: "x", parts: [{ type: "text", text: "x" }, a, b] })).toEqual([a, b]);
  });

  it("inputText returns the string or the text field", () => {
    expect(inputText("abc")).toBe("abc");
    expect(inputText({ text: "def" })).toBe("def");
  });
});

describe("checkVectors", () => {
  it("passes matching vectors through", () => {
    const v = [[1, 2], [3, 4]];
    expect(checkVectors(v, 2)).toBe(v);
    expect(checkVectors(v, 2, 2)).toBe(v);
  });

  it("throws on count mismatch", () => {
    expect(() => checkVectors([[1]], 2)).toThrow(/returned 1 vectors for 2 inputs/);
    expect(() => checkVectors([], 1)).toThrow(/0 vectors for 1 inputs/);
  });

  it("throws on dimension mismatch", () => {
    expect(() => checkVectors([[1, 2], [1]], 2, 2)).toThrow(/expected 2 dimensions, got 1/);
  });

  it("skips the dimension check when dimensions is undefined", () => {
    expect(() => checkVectors([[1], [1, 2]], 2)).not.toThrow();
  });
});
