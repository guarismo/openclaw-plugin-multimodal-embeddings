import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { prepareMedia } from "./media.js";

const FFMPEG = "/usr/bin/ffmpeg";
const opts = { convertMedia: true, ffmpegPath: FFMPEG };
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function ffmpegBuffer(args: string[]): Buffer {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", ...args, "pipe:1"], {
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0 || r.stdout.length === 0) throw new Error(`ffmpeg fixture failed: ${r.stderr?.toString()}`);
  return r.stdout;
}

const image = (fmt: string, codecArgs: string[] = []) =>
  ffmpegBuffer(["-f", "lavfi", "-i", "color=c=red:s=16x16", "-frames:v", "1", ...codecArgs, "-f", fmt]);

describe("prepareMedia passthrough", () => {
  const bad = { convertMedia: true, ffmpegPath: "/nonexistent/ffmpeg" };

  it("passes native media through unchanged without running ffmpeg", async () => {
    expect(await prepareMedia({ mimeType: "image/jpeg", data: "not-even-base64!" }, bad)).toEqual({
      mimeType: "image/jpeg",
      data: "not-even-base64!",
    });
    expect(await prepareMedia({ mimeType: "audio/wav", data: "AAAA" }, bad)).toEqual({ mimeType: "audio/wav", data: "AAAA" });
    expect(await prepareMedia({ mimeType: "audio/mpeg", data: "AAAA" }, bad)).toEqual({ mimeType: "audio/mpeg", data: "AAAA" });
  });

  it("lowercases the mime type of native media", async () => {
    expect(await prepareMedia({ mimeType: "IMAGE/PNG", data: "AA" }, bad)).toEqual({ mimeType: "image/png", data: "AA" });
  });

  it("passes native media through even when convertMedia is false", async () => {
    const r = await prepareMedia({ mimeType: "image/png", data: "AA" }, { convertMedia: false, ffmpegPath: "ffmpeg" });
    expect(r.mimeType).toBe("image/png");
  });
});

describe("prepareMedia errors", () => {
  it("throws mentioning convertMedia for non-native media when conversion is off", async () => {
    await expect(
      prepareMedia({ mimeType: "image/webp", data: "AA" }, { convertMedia: false, ffmpegPath: FFMPEG }),
    ).rejects.toThrow(/convertMedia/);
  });

  it("throws mentioning convertMedia for non-image/audio types even with conversion on", async () => {
    await expect(prepareMedia({ mimeType: "video/mp4", data: "AA" }, opts)).rejects.toThrow(/convertMedia/);
  });

  it("reports 'cannot run' for a bad ffmpegPath", async () => {
    await expect(
      prepareMedia({ mimeType: "image/webp", data: "AA" }, { convertMedia: true, ffmpegPath: "/nonexistent/ffmpeg" }),
    ).rejects.toThrow(/cannot run/);
    await expect(
      prepareMedia({ mimeType: "audio/ogg", data: "AA" }, { convertMedia: true, ffmpegPath: "/nonexistent/ffmpeg" }),
    ).rejects.toThrow(/cannot run/);
  });

  it("reports a conversion failure for garbage input", async () => {
    await expect(
      prepareMedia({ mimeType: "image/webp", data: Buffer.from("this is not an image").toString("base64") }, opts),
    ).rejects.toThrow(/ffmpeg conversion failed/);
  });
});

describe("prepareMedia ffmpeg conversion", () => {
  it("converts BMP to PNG", async () => {
    const bmp = image("image2pipe", ["-vcodec", "bmp"]);
    const r = await prepareMedia({ mimeType: "image/bmp", data: bmp.toString("base64") }, opts);
    expect(r.mimeType).toBe("image/png");
    expect(Buffer.from(r.data, "base64").subarray(0, 8).equals(PNG_SIG)).toBe(true);
  });

  it("converts WebP to PNG", async () => {
    const webp = image("webp");
    const r = await prepareMedia({ mimeType: "image/webp", data: webp.toString("base64") }, opts);
    expect(r.mimeType).toBe("image/png");
    expect(Buffer.from(r.data, "base64").subarray(0, 8).equals(PNG_SIG)).toBe(true);
  });

  it("converts GIF to PNG", async () => {
    const gif = image("gif");
    const r = await prepareMedia({ mimeType: "image/gif", data: gif.toString("base64") }, opts);
    expect(r.mimeType).toBe("image/png");
    expect(Buffer.from(r.data, "base64").subarray(0, 8).equals(PNG_SIG)).toBe(true);
  });

  it("converts FLAC to 16 kHz mono WAV", async () => {
    const flac = ffmpegBuffer(["-f", "lavfi", "-i", "sine=frequency=440:duration=0.3", "-ac", "2", "-ar", "44100", "-f", "flac"]);
    const r = await prepareMedia({ mimeType: "audio/flac", data: flac.toString("base64") }, opts);
    expect(r.mimeType).toBe("audio/wav");
    const wav = Buffer.from(r.data, "base64");
    expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wav.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(wav.readUInt16LE(22)).toBe(1); // channels
    expect(wav.readUInt32LE(24)).toBe(16000); // sample rate
  });

  it("converts Ogg/Opus to WAV", async () => {
    const ogg = ffmpegBuffer(["-f", "lavfi", "-i", "sine=frequency=440:duration=0.3", "-c:a", "libopus", "-f", "ogg"]);
    const r = await prepareMedia({ mimeType: "audio/ogg", data: ogg.toString("base64") }, opts);
    expect(r.mimeType).toBe("audio/wav");
    expect(Buffer.from(r.data, "base64").subarray(0, 4).toString("ascii")).toBe("RIFF");
  });
});
