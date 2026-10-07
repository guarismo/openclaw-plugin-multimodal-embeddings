import { spawn } from "node:child_process";
import { isNativeMedia, modalityOf, type PreparedMedia } from "./request.js";

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

/** Run ffmpeg with the file on stdin and return its stdout. */
function ffmpegPipe(ffmpegPath: string, input: Buffer, outputArgs: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", ...outputArgs, "pipe:1"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = "";
    const timer = setTimeout(() => proc.kill("SIGKILL"), TIMEOUT_MS);
    proc.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) proc.kill("SIGKILL");
      else chunks.push(chunk);
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-500);
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`multimodal-embeddings: cannot run ${ffmpegPath} (${err.message}); install ffmpeg or set convertMedia: false`));
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && size > 0 && size <= MAX_OUTPUT_BYTES) resolve(Buffer.concat(chunks));
      else reject(new Error(`multimodal-embeddings: ffmpeg conversion failed (exit ${code}): ${stderr.trim()}`));
    });
    proc.stdin.on("error", () => undefined); // ffmpeg may close stdin early on bad input; "close" reports it
    proc.stdin.end(input);
  });
}

/**
 * Return media the server can decode. JPEG/PNG images and WAV/MP3 audio pass through;
 * other formats are converted with ffmpeg (images to PNG, audio to 16 kHz mono WAV).
 */
export async function prepareMedia(
  part: { mimeType: string; data: string },
  opts: { convertMedia: boolean; ffmpegPath: string },
): Promise<PreparedMedia> {
  if (isNativeMedia(part.mimeType)) return { mimeType: part.mimeType.toLowerCase(), data: part.data };
  const modality = modalityOf(part.mimeType);
  if (!opts.convertMedia || !modality) {
    throw new Error(`multimodal-embeddings: ${part.mimeType} is not supported by the server; enable convertMedia to convert it`);
  }
  const input = Buffer.from(part.data, "base64");
  if (modality === "image") {
    const png = await ffmpegPipe(opts.ffmpegPath, input, ["-frames:v", "1", "-f", "image2pipe", "-vcodec", "png"]);
    return { mimeType: "image/png", data: png.toString("base64") };
  }
  const wav = await ffmpegPipe(opts.ffmpegPath, input, ["-vn", "-ac", "1", "-ar", "16000", "-f", "wav"]);
  return { mimeType: "audio/wav", data: wav.toString("base64") };
}
