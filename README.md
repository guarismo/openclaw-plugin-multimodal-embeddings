# Multimodal Embeddings (OpenAI-compatible)

An OpenClaw plugin that registers a memory embedding provider named `multimodal-embeddings`. It sends text, and optionally images and audio, to any server that exposes an OpenAI-compatible `/v1/embeddings` endpoint. It also adds an agent tool, `multimodal_media_search`, that finds photos and recordings by describing them.

## Why

OpenClaw's built-in multimodal memory indexing only works with Gemini. This plugin lets you index images and audio with a model you run yourself, so the files never leave your machine. It also works as a plain text embedding provider for any OpenAI-compatible server, and it adds the task prefixes that EmbeddingGemma needs.

## Screenshots

An agent finding media in its memory by describing it. The files have camera-style names (`IMG_0003.png`, `VOICE_0004.opus`), so the match comes from the content.

Image search in the Control UI:

![Agent finds "the picture of the desert with red rocks" with memory_search and returns the image](https://raw.githubusercontent.com/guarismo/openclaw-plugin-multimodal-embeddings/main/docs/screenshots/image-search.png)

Audio search in the Control UI, returning a playable voice note:

![Agent finds "the voice note about the birthday party" with memory_search and returns VOICE_0004.opus](https://raw.githubusercontent.com/guarismo/openclaw-plugin-multimodal-embeddings/main/docs/screenshots/audio-search.png)

The same from Discord:

![Discord: "find the photo of the mountain at sunset" returns the matching photo with its search score](https://raw.githubusercontent.com/guarismo/openclaw-plugin-multimodal-embeddings/main/docs/screenshots/discord-image-search.jpg)

## Requirements

- OpenClaw 2026.9.8 or newer.
- A server that exposes an OpenAI-compatible `/v1/embeddings` endpoint.
- For images and audio: a multimodal embedding model. The tested setup is llama.cpp `llama-server` started with `--embeddings` and `--mmproj`, serving `ggml-org/embeddinggemma-2-GGUF`.
- `ffmpeg`, only if you want media converted automatically (on by default). See "Supported files".

## Install

From a local path:

```bash
openclaw plugins install /path/to/multimodal-embeddings
```

A ClawHub install (`clawhub:openclaw-plugin-multimodal-embeddings`) will be available later.

The plugin is loaded from `dist/`, so run `npm run build` in the plugin directory first if you install from source.

## Configuration

Example (JSON5):

```json5
{
  memory: {
    search: {
      provider: "multimodal-embeddings",
      model: "embeddinggemma-2",
      remote: {
        baseUrl: "http://127.0.0.1:8080/v1",
        apiKey: "none",
      },
      multimodal: {
        enabled: true,
        modalities: ["image", "audio"],
      },
      // Media is only indexed from extra paths.
      extraPaths: ["~/Pictures/notes", "~/Recordings"],
    },
  },
  plugins: {
    entries: {
      "multimodal-embeddings": {
        config: {
          convertMedia: true,
          ffmpegPath: "ffmpeg",
          batchSize: 32,
          models: {
            // Key = the model id sent to the server (memory.search.model).
            "embeddinggemma-2": {
              modalities: ["image", "audio"],
              mediaLabel: "include",
              dimensions: 768,
            },
          },
        },
      },
    },
  },
}
```

`memory.search.model` must be set. If `remote.baseUrl` is omitted, the plugin uses `http://127.0.0.1:8080/v1`.

The plugin only reports multimodal support for a model whose entry lists `modalities`. Without that, `memory.search.multimodal` is rejected for the model. A model with no entry is treated as text-only.

### Plugin options

Set these under `plugins.entries["multimodal-embeddings"].config`.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `models` | object | none | Per-model settings, keyed by the model id sent to the server. Use `"*"` as a fallback for models without their own entry. An exact entry is not merged with `"*"`. |
| `models.<id>.modalities` | array of `"image"`, `"audio"` | `[]` | Media this model can embed in the same space as text. Omit for a text-only model. |
| `models.<id>.mediaFormat` | `"content-parts"` | `"content-parts"` | Request shape for media. `content-parts` is the llama.cpp / OpenRouter `{content:[...]}` format. |
| `models.<id>.preset` | `"none"`, `"embeddinggemma"` | `embeddinggemma` if the model id contains "embeddinggemma" (any case), else `none` | Built-in prompt prefixes. |
| `models.<id>.queryPrefix` | string | from preset | Overrides the preset's query prefix. |
| `models.<id>.documentPrefix` | string | from preset | Overrides the preset's document prefix. |
| `models.<id>.mediaLabel` | `"include"`, `"omit"` | `"include"` | Whether to send memory's "Image file: <path>" label along with the media. |
| `models.<id>.dimensions` | integer >= 1 | unset | Expected vector size. Vectors of any other size cause an error. |
| `convertMedia` | boolean | `true` | Convert media the server cannot decode with ffmpeg before sending. |
| `ffmpegPath` | string | `"ffmpeg"` | Path to the ffmpeg binary. |
| `batchSize` | integer 1-256 | `32` | Inputs per request. Values above 256 are clamped to 256. |

The EmbeddingGemma preset uses `task: search result | query: ` for queries and `title: none | text: ` for documents.

## Finding media: `multimodal_media_search`

Use this tool, not `memory_search`, to find photos and recordings.

`memory_search` ranks media and text together, and in a real memory the media rarely surfaces. Three things work against it, and none of them can be configured: text-to-text similarity runs higher than text-to-image or text-to-audio similarity with the same model; memory-core applies a 30-day recency decay to files in `extraPaths`; and a media file has no keyword text, so it gets none of the 30% keyword share of the score. With a few months of food photos in an agent's memory, notes about food outrank every photo.

`multimodal_media_search` searches only the image and audio vectors that memory already stored for the calling agent, so none of that applies. It does not embed media again; it embeds the query the same way memory does and compares it with the stored vectors, which takes tens of milliseconds.

Parameters:

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `query` | string | required | What the photo shows or the recording says. `description` is accepted as an alias. |
| `kind` | `image` \| `audio` \| `any` | `any` | Limit the search to one kind. |
| `maxResults` | integer 1-10 | `3` | Number of results. |

It returns workspace paths with scores, plus the median score of everything searched. Scores are relative: a good match is clearly above the median (for EmbeddingGemma 2, typically 0.1 or more).

The tool only works for agents whose `memory.search.provider` is `multimodal-embeddings`. Agents with a tool allow list need `multimodal_media_search` added to it (and to `tools.sandbox.tools.alsoAllow` for sandboxed agents). OpenClaw asks for capability consent the first time the plugin registers a tool: `openclaw plugins enable multimodal-embeddings --accept-capabilities`.

Small models pick the right tool more reliably with a line in the agent's `AGENTS.md`, for example:

```markdown
When asked to find a photo, picture, screenshot, voice note or audio clip, call `multimodal_media_search`
with a description of its content, then send the best match as an attachment using its `path` exactly as given.
```

## Notes

### Reindex after any change

Changing the model, prefixes, `mediaLabel`, `dimensions` or the server changes the vectors. Rebuild the index afterwards:

```bash
openclaw memory index --force --agent <id>
```

### Supported files

memory-core indexes these types, and only from `memory.search.extraPaths`:

- Images: `.jpg` `.jpeg` `.png` `.webp` `.gif` `.heic` `.heif`
- Audio: `.mp3` `.wav` `.ogg` `.opus` `.m4a` `.m2a` `.aac` `.flac`

JPEG and PNG images, WAV audio and MP3 audio are sent as they are. Everything else is converted with ffmpeg when `convertMedia` is true: images become PNG, audio becomes 16 kHz mono WAV. With `convertMedia: false`, a non-native file causes an error.

HEIC and HEIF support depends on how your ffmpeg was built. If your build cannot decode them, those files fail to convert.

### mediaLabel

memory-core sends a text label such as "Image file: <path>" with each media file.

- `include`: the label is sent with the media, so the file name influences matching. A query that resembles a file name can find the file even if the content is unrelated.
- `omit`: only the media is embedded, so matching depends on the content alone.

### Text-only use

The plugin also works with text models. Set no `modalities` and do not enable `memory.search.multimodal`. Models whose id contains "embeddinggemma" still get the EmbeddingGemma query and document prefixes.

## Development

```bash
npm run build
npm test
```
