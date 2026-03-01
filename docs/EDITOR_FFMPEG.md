# Video Editor + FFmpeg "Pre-composition" (Server-side)

This repo now supports a CapCut-like editing workflow:

- **Live preview** in the browser (timeline cuts/trims/speed) using a single `<video>` element.
- **Server-side render/export** using **FFmpeg filtergraphs** to "pre-compose" the timeline into a real MP4 file.

## API (backend)

Endpoint:

```txt
POST /api/editor/video/{id}/render
```

Returns:

- `200` with `video/mp4` body (an attachment download)

Payload (shape used by the frontend `tracks` store; extra fields are ignored):

```json
{
  "mode": "preview",
  "tracks": [
    { "type": "video", "clips": [ { "type": "video", "startTime": 0, "duration": 3, "trimStart": 10, "trimEnd": 13, "speed": 1, "volume": 1, "url": "https://..." } ] },
    { "type": "audio", "clips": [ { "type": "audio", "startTime": 1.5, "trimStart": 0, "trimEnd": 4, "volume": 1, "fadeIn": 0.1, "fadeOut": 0.2, "url": "https://..." } ] }
  ],
  "export": { "width": 1920, "height": 1080, "frameRate": 30, "format": "mp4", "crf": 23, "includeAudio": true }
}
```

Implementation:

- `backend/internal/services/editor_render.go`
- `backend/internal/handlers/editor.go` (`RenderVideo`)

## Render strategy (FFmpeg filtergraph)

The renderer now builds a full timeline canvas and layers clips with `overlay`:

1. **Base timeline**: black canvas for full duration (`color`) + optional silent base audio (`anullsrc`)
2. **Visual clips**: each clip is trimmed/scaled/effected, then overlaid at its timeline position
3. **Stacked tracks**: multiple video/image tracks are composed in layer order
4. **Audio mix**: visual-track audio + dedicated audio tracks are delayed and mixed (`amix`)
5. **Captions**: caption clips are burned in with `drawtext` and timeline `enable` windows

### Current parity with the live editor

The current implementation now renders these timeline controls server-side:

- **Visual effects** per clip: brightness, contrast, saturation, blur
- **Stacked visual tracks**: overlapping video/image clips are composited with `overlay`
- **Clip transitions**: timeline transition metadata is rendered as crossfades (alpha blend)
- **Audio controls** per clip: volume, fade in/out, delays on timeline
- **Caption clips**: burned into output using `drawtext` with start/end timing
- **Multiple audio tracks**: mixed into the final timeline output

Current limitation:

- Transition styles are normalized to crossfade behavior in export (non-fade UI styles currently map to fade-like blending).

### Key filters used

- Video cutting: `trim`, `setpts`
- Audio cutting: `atrim`, `asetpts`
- Speed: `setpts=PTS/speed`, plus `atempo` chains (0.25–4x)
- Layered compositing: `overlay`
- Gaps/base timeline: `color` + `anullsrc`
- Audio overlays: `adelay` + `amix`
- Visual effects: `eq` + `gblur`
- Captions: `drawtext`

## Useful official FFmpeg docs

- Filters manual: `https://ffmpeg.org/ffmpeg-filters.html`
- Formats / concat demuxer: `https://ffmpeg.org/ffmpeg-formats.html`
- Main ffmpeg options (includes `-filter_complex` and `-progress`): `https://ffmpeg.org/ffmpeg.html`
- ffprobe: `https://ffmpeg.org/ffprobe.html`
- `drawtext` filter docs: `https://ffmpeg.org/ffmpeg-filters.html#drawtext`
- `eq` filter docs: `https://ffmpeg.org/ffmpeg-filters.html#eq`
- `gblur` filter docs: `https://ffmpeg.org/ffmpeg-filters.html#gblur`
- `amix` filter docs: `https://ffmpeg.org/ffmpeg-filters.html#amix`
- `overlay` filter docs: `https://ffmpeg.org/ffmpeg-filters.html#overlay`

### Progress reporting

For long renders you can add:

```bash
ffmpeg ... -progress pipe:1 -nostats ...
```

Docs:

- `-progress` option: `https://ffmpeg.org/ffmpeg.html`

## Web video editor notes (FFmpeg + browser)

There are two common approaches:

1) **Server-side rendering (this repo’s current approach)**
- Pros: fastest to ship, uses "real" ffmpeg, supports full codec set
- Cons: needs backend compute, large uploads, async jobs for big exports

2) **In-browser rendering using ffmpeg.wasm**
- Pros: no backend compute, local-first, privacy-friendly
- Cons: slower, memory-heavy, codec limitations, large projects can crash the tab

ffmpeg.wasm:

- Repo/docs: `https://github.com/ffmpegwasm/ffmpeg.wasm`

Practical tutorials / example projects:

- Fireship tutorial (React + ffmpeg.wasm, video→GIF): `https://fireship.io/lessons/wasm-video-to-gif/`
- Fireship video: `https://www.youtube.com/watch?v=-OTc0Ki7Sv0`
- Example app (browser video compression with ffmpeg.wasm): `https://github.com/addyosmani/video-compress`
- Example app (trim + compress with ffmpeg.wasm): `https://github.com/Jezzabell91/ffmpeg-trim-and-compress`
- Example app (simple in-browser editor): `https://github.com/imgly/video-editor-wasm-react`

## Next FFmpeg features to reach a true CapCut clone

- **Native transition styles**: `xfade` variants + style-matched audio transitions
- **Overlays**: stickers, text, picture-in-picture authoring in timeline UI
- **Captions**: `subtitles` (SRT/ASS) or `drawtext` for styled captions
- **Proxy generation** (for responsive editing): low-res transcodes + waveform caching

Transition tutorial:

- `xfade` basics: `https://ottverse.com/crossfade-between-videos-ffmpeg-xfade-filter/`
