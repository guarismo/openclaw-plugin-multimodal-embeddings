import { describe, expect, it } from "vitest";
import { kindOf, rankMedia, TOOL_NAME } from "./media-search.js";

describe("kindOf", () => {
  it("classifies the extensions memory-core indexes", () => {
    for (const p of ["a.jpg", "b.JPEG", "c.png", "d.webp", "e.gif", "f.heic", "g.heif"]) expect(kindOf(p)).toBe("image");
    for (const p of ["a.mp3", "b.wav", "c.ogg", "d.opus", "e.m4a", "f.m2a", "g.aac", "h.flac"]) expect(kindOf(p)).toBe("audio");
    for (const p of ["MEMORY.md", "notes.txt", "photo.jpg.md", "jpg"]) expect(kindOf(p)).toBeUndefined();
  });
});

describe("rankMedia", () => {
  const rows = [
    { path: "MEMORY.md", embedding: [1, 0] },
    { path: "media/a.jpg", embedding: [1, 0] },
    { path: "media/b.png", embedding: [0.6, 0.8] },
    { path: "media/c.wav", embedding: [0.8, 0.6] },
    { path: "media/d.jpg", embedding: [0, 1] },
    { path: "media/broken.jpg", embedding: [] },
  ];

  it("ranks only media files, best first, and ignores text and empty vectors", () => {
    const r = rankMedia([1, 0], rows, { maxResults: 10 });
    expect(r.searched).toBe(4);
    expect(r.hits.map((h) => h.path)).toEqual(["media/a.jpg", "media/c.wav", "media/b.png", "media/d.jpg"]);
    expect(r.hits[0].score).toBeCloseTo(1);
  });

  it("filters by kind and caps the result count", () => {
    expect(rankMedia([1, 0], rows, { kind: "audio", maxResults: 10 }).hits.map((h) => h.path)).toEqual(["media/c.wav"]);
    const images = rankMedia([1, 0], rows, { kind: "image", maxResults: 2 });
    expect(images.searched).toBe(3);
    expect(images.hits.map((h) => h.kind)).toEqual(["image", "image"]);
  });

  it("reports the median score of everything searched", () => {
    const r = rankMedia([1, 0], rows, { maxResults: 1 });
    expect(r.median).toBeCloseTo(0.6); // scores 1, 0.8, 0.6, 0 -> index 2 of the sorted list
  });

  it("handles no media at all", () => {
    expect(rankMedia([1, 0], [{ path: "MEMORY.md", embedding: [1, 0] }], { maxResults: 3 })).toEqual({ hits: [], median: 0, searched: 0 });
  });

  it("uses a namespaced tool name", () => {
    expect(TOOL_NAME).toBe("multimodal_media_search");
  });
});
