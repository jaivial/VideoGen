# CapCut-Like Video Editor - Implementation Plan

## Project Overview
Transform the current basic video editor into a full-featured CapCut clone with:
- Mobile-friendly inline video playback
- Full non-linear editing (timeline, trimming, splitting, transitions)
- Audio timeline with waveform visualization
- Caption timeline for visual editing
- Filters, effects, and color grading
- Text/sticker overlays
- Speed ramping
- Real-time preview
- Undo/redo support

---

## Phase 1: Core Architecture & Mobile-Optimized Player

### 1.1 Frontend Dependencies
Install necessary packages:
```json
{
  "@dnd-kit/core": "^6.1.0",
  "@dnd-kit/sortable": "^8.0.0",
  "@dnd-kit/utilities": "^3.2.2",
  "zustand": "^4.4.0",
  "immer": "^10.0.0",
  "uuid": "^9.0.0"
}
```

### 1.2 State Management (Zustand Store)
Create `frontend/src/stores/editorStore.ts`:
- Project state (name, resolution, frameRate)
- Timeline state (tracks, clips, currentTime, playhead)
- Selection state (selectedClipIds, selectedTrackId)
- History state (undo/redo stacks)
- UI state (zoom, scroll, activePanel)

### 1.3 Mobile-Optimized Video Player
- Replace fullscreen-only player with inline HTML5 video
- Add responsive container that maintains aspect ratio
- Touch-friendly controls (tap to play/pause, pinch to zoom preview)
- Support for multiple video elements for multi-track preview
- WebGL-based preview renderer for effects previews

### 1.4 New Data Types
```typescript
interface Track {
  id: string
  type: 'video' | 'audio' | 'caption'
  clips: Clip[]
  muted: boolean
  locked: boolean
  visible: boolean
}

interface Clip {
  id: string
  trackId: string
  mediaId: string
  name: string
  type: 'video' | 'image' | 'audio'
  startTime: number      // position on timeline
  duration: number       // display duration
  trimStart: number      // in-point within source
  trimEnd: number        // out-point within source
  volume: number
  speed: number
  effects: Effect[]
  url: string
}

interface CaptionClip extends Clip {
  text: string
  style: CaptionStyle
}

interface Effect {
  id: string
  type: 'transition' | 'filter' | 'text' | 'sticker'
  params: Record<string, any>
}
```

---

## Phase 2: Timeline Components

### 2.1 Timeline Track System
- Multi-track support (unlimited video, audio, caption tracks)
- Track add/remove/reorder
- Track controls (mute, lock, visibility, volume)
- Track headers with labels

### 2.2 Clip Operations
- **Drag & Drop**: Move clips horizontally (time) and vertically (tracks)
- **Trim Handles**: Visual handles on clip edges for trimming in/out points
- **Split**: Split clip at playhead position (blade tool)
- **Ripple Edit**: Auto-adjust neighboring clips when trimming
- **Snap**: Snap to playhead, clip edges, and markers

### 2.3 Timeline Rendering
- Canvas-based rendering for performance
- Zoom in/out (mouse wheel + buttons)
- Horizontal scroll with playhead following
- Waveform visualization for audio tracks
- Thumbnail strip for video clips

### 2.4 Playhead & Scrubbing
- Draggable playhead
- Frame-accurate seeking
- J/K/L shuttle playback
- Keyboard shortcuts (Space, ←→, J/K/L)

---

## Phase 3: Audio Timeline

### 3.1 Audio Track Features
- Multiple audio tracks
- Volume control per track
- Volume keyframes
- Fade in/out handles
- Audio ducking (auto-lower background music)

### 3.2 Waveform Visualization
- Generate waveform data from audio files
- Render waveforms on timeline
- Click-to-seek on waveform

### 3.3 Audio Editing
- Extract audio from video clips
- Add standalone audio clips
- Audio fade effects
- Mute/solo tracks

---

## Phase 4: Caption Timeline

### 4.1 Visual Caption Editing
- Display captions as blocks on caption track
- Drag to reposition
- Resize handles to adjust duration
- Click to edit text inline

### 4.2 Caption Styles
- Font family, size, color
- Background color/opacity
- Position (top, center, bottom)
- Animation (none, fade, typewriter, kinetic)
- Alignment

### 4.3 Caption Import/Export
- Import from SRT, VTT, ASS
- Export to SRT, VTT, ASS
- Sync with Whisper transcript

---

## Phase 5: Effects & Transitions

### 5.1 Transitions
- Fade in/out
- Dissolve (cross-fade)
- Wipe (left, right, up, down)
- Slide (push)
- Zoom in/out

### 5.2 Filters
- Brightness, contrast, saturation
- Temperature (warm/cool)
- Vignette
- Blur
- Color LUTs

### 5.3 Text Overlays
- Add text at any position on canvas
- Font selection
- Size, color, stroke, shadow
- Animations (pop, fade, slide, typewriter)
- Keyframe animations

### 5.4 Stickers/Emojis
- Import sticker images
- Position, scale, rotate
- Animate stickers

---

## Phase 6: Speed & Advanced Features

### 6.1 Speed Ramping
- Change clip speed (0.25x to 4x)
- Curve-based speed changes
- Maintain audio pitch option

### 6.2 Keyframe Animation
- Position (x, y)
- Scale
- Rotation
- Opacity
- Effects parameters

### 6.3 Green Screen
- Chroma key filter
- Pick background color
- Tolerance slider

---

## Phase 7: Preview Engine

### 7.1 Client-Side Preview
- HTML5 Video compositing for basic preview
- WebGL for effects preview
- Real-time filter preview
- Preview at reduced resolution for performance

### 7.2 Export Options
- Resolution presets (720p, 1080p, 4K)
- Format options (MP4, WebM)
- Quality/CRF settings
- Progress tracking

---

## Phase 8: Project Management

### 8.1 Save/Load
- Auto-save to localStorage
- Project JSON export/import
- Cloud save (future)

### 8.2 Undo/Redo
- Action-based history
- 50+ undo levels
- Keyboard shortcuts (Ctrl+Z, Ctrl+Shift+Z)

### 8.3 Collaboration (Future)
- Share projects
- Export/import project files

---

## Backend Enhancements

### 9.1 Editor Processing API
New endpoint: `POST /api/editor/process`
```go
type ProcessRequest struct {
  ProjectID    uint64         `json:"project_id"`
  Tracks       []Track        `json:"tracks"`
  OutputConfig OutputConfig   `json:"output_config"`
}

type OutputConfig struct {
  Resolution   string         `json:"resolution"`  // "1920x1080"
  FrameRate    int            `json:"frame_rate"` // 30, 60
  Format       string         `json:"format"`      // "mp4", "webm"
  Quality      int            `json:"quality"`    // CRF value
}
```

### 9.2 FFmpeg Pipeline Updates
- Segment-based processing with accurate timing
- Filter complex for effects
- Multiple audio track mixing
- Subtitle burning

### 9.3 Media Management
- List user media library
- Thumbnail generation
- Duration/metadata extraction

---

## Implementation Priority

1. **Week 1**: Mobile player + Zustand store + basic timeline
2. **Week 2**: Clip drag/drop + trimming + splitting
3. **Week 3**: Audio timeline + waveform
4. **Week 4**: Caption timeline + styling
5. **Week 5**: Transitions + basic filters
6. **Week 6**: Text overlays + stickers
7. **Week 7**: Speed control + keyframes
8. **Week 8**: Export pipeline + project save/load

---

## File Structure

```
frontend/src/
├── components/
│   ├── editor/
│   │   ├── VideoPlayer.tsx
│   │   ├── Timeline/
│   │   │   ├── Timeline.tsx
│   │   │   ├── Track.tsx
│   │   │   ├── Clip.tsx
│   │   │   ├── Playhead.tsx
│   │   │   ├── Waveform.tsx
│   │   │   └── TimeRuler.tsx
│   │   ├── Panels/
│   │   │   ├── MediaPanel.tsx
│   │   │   ├── EffectsPanel.tsx
│   │   │   ├── TextPanel.tsx
│   │   │   └── ExportPanel.tsx
│   │   └── Toolbar/
│   │       ├── Toolbar.tsx
│   │       └── ToolButtons.tsx
├── stores/
│   └── editorStore.ts
├── hooks/
│   ├── useTimeline.ts
│   ├── useMedia.ts
│   └── useHistory.ts
├── utils/
│   ├── timeUtils.ts
│   ├── waveformUtils.ts
│   └── exportUtils.ts
└── types/
    └── editor.ts
```

---

## Success Criteria

- [ ] Mobile-friendly inline video playback
- [ ] Multi-track timeline with drag/drop
- [ ] Clip trimming with handles
- [ ] Clip splitting at playhead
- [ ] Audio timeline with waveform
- [ ] Caption timeline with visual editing
- [ ] At least 3 transition types
- [ ] At least 5 filter presets
- [ ] Text overlay with basic styling
- [ ] Speed control per clip
- [ ] Export to MP4
- [ ] Undo/redo functionality
- [ ] Project save/load
