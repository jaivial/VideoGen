// Editor Types - CapCut-like video editor data structures

export interface Project {
  id: string
  name: string
  resolution: Resolution
  frameRate: number
  duration: number
  createdAt: number
  updatedAt: number
}

export interface Resolution {
  width: number
  height: number
  label: string
}

export const RESOLUTIONS: Resolution[] = [
  { width: 1920, height: 1080, label: '1080p' },
  { width: 1280, height: 720, label: '720p' },
  { width: 3840, height: 2160, label: '4K' },
  { width: 1080, height: 1920, label: '9:16 (Portrait)' },
  { width: 1080, height: 1080, label: '1:1 (Square)' },
]

export interface CompositionPreset {
  id: string
  label: string
  description: string
  resolution: Resolution
  frameRate: number
}

export const COMPOSITION_PRESETS: CompositionPreset[] = [
  {
    id: 'landscape',
    label: 'Landscape 16:9',
    description: 'YouTube and widescreen',
    resolution: RESOLUTIONS[0],
    frameRate: 30,
  },
  {
    id: 'portrait',
    label: 'Portrait 9:16',
    description: 'TikTok, Shorts, Reels',
    resolution: RESOLUTIONS[3],
    frameRate: 30,
  },
  {
    id: 'square',
    label: 'Square 1:1',
    description: 'Feeds and promos',
    resolution: RESOLUTIONS[4],
    frameRate: 30,
  },
  {
    id: 'cinema-4k',
    label: 'Cinema 4K',
    description: 'Master export',
    resolution: RESOLUTIONS[2],
    frameRate: 60,
  },
]

export const getResolutionValue = (resolution: Resolution) => `${resolution.width}x${resolution.height}`

// Base clip interface
export interface BaseClip {
  id: string
  trackId: string
  mediaId: string
  name: string
  type: 'video' | 'image' | 'audio' | 'caption'
  startTime: number        // position on timeline in seconds
  duration: number         // display duration in seconds
  trimStart: number        // in-point within source media (seconds)
  trimEnd: number          // out-point within source media (seconds)
  url: string
  thumbnailUrl?: string
}

// Video/Image clip
export interface VideoClip extends BaseClip {
  type: 'video' | 'image'
  volume: number           // 0-1
  speed: number           // 0.25-4
  volumeKeyframes: Keyframe[]
  speedKeyframes: Keyframe[]
  effects: Effect[]
  // Original media properties
  originalWidth?: number
  originalHeight?: number
  originalDuration?: number
  originalFps?: number
}

// Audio clip
export interface AudioClip extends BaseClip {
  type: 'audio'
  volume: number
  fadeIn: number          // fade in duration
  fadeOut: number         // fade out duration
  volumeKeyframes: Keyframe[]
  effects: Effect[]
  waveformData?: number[]  // Pre-extracted waveform peaks for visualization
}

export type Clip = VideoClip | AudioClip | CaptionClip

// Caption clip with styling
export interface CaptionClip extends Omit<BaseClip, 'type'> {
  type: 'caption'
  text: string
  style: CaptionStyle
}

export type TimelineClip = Clip

// Track interface
export interface Track {
  id: string
  type: 'video' | 'audio' | 'caption'
  name: string
  clips: TimelineClip[]
  muted: boolean
  locked: boolean
  visible: boolean
  volume: number
  height: number
}

// Keyframe for animations
export interface Keyframe {
  id: string
  time: number           // position in seconds
  value: number
  easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
}

// Effect base
export interface Effect {
  id: string
  type: EffectType
  name: string
  params: Record<string, number | string | boolean>
  enabled: boolean
}

export type EffectType =
  | 'brightness'
  | 'contrast'
  | 'saturation'
  | 'temperature'
  | 'vignette'
  | 'blur'
  | 'chroma-key'
  | 'fade'
  | 'dissolve'
  | 'wipe'
  | 'slide'
  | 'zoom'

// Transition (special effect between clips)
export interface Transition extends Effect {
  type: 'fade' | 'dissolve' | 'wipe' | 'slide' | 'zoom'
  duration: number
  direction?: 'left' | 'right' | 'up' | 'down'
}

// Caption styling
export type CaptionPosition = 'top' | 'center' | 'bottom'
export type CaptionAlignment = 'left' | 'center' | 'right'
export type CaptionAnimation = 'none' | 'fade' | 'typewriter' | 'pop' | 'slide-up' | 'slide-down'
export type CaptionTextTransform = 'none' | 'uppercase' | 'lowercase' | 'capitalize'
export type CaptionBoxStyle = 'none' | 'solid' | 'pill'

export interface CaptionStyle {
  fontFamily: string
  fontSize: number
  fontWeight: number
  italic: boolean
  underline: boolean
  textTransform: CaptionTextTransform
  letterSpacing: number
  opacity: number
  color: string
  backgroundColor: string
  backgroundOpacity: number
  boxStyle: CaptionBoxStyle
  paddingX: number
  paddingY: number
  borderRadius: number
  strokeColor: string
  strokeWidth: number
  shadowColor: string
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
  position: CaptionPosition
  alignment: CaptionAlignment
  offsetX: number
  offsetY: number
  maxWidthPercent: number
  animation: CaptionAnimation
  animationDuration: number
  animationStrength: number
  lineHeight: number
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontFamily: 'Arial',
  fontSize: 32,
  fontWeight: 400,
  italic: false,
  underline: false,
  textTransform: 'none',
  letterSpacing: 0,
  opacity: 1,
  color: '#ffffff',
  backgroundColor: '#000000',
  backgroundOpacity: 0,
  boxStyle: 'solid',
  paddingX: 24,
  paddingY: 12,
  borderRadius: 18,
  strokeColor: '#000000',
  strokeWidth: 2,
  shadowColor: '#000000',
  shadowBlur: 4,
  shadowOffsetX: 2,
  shadowOffsetY: 2,
  position: 'bottom',
  alignment: 'center',
  offsetX: 0,
  offsetY: 0,
  maxWidthPercent: 84,
  animation: 'fade',
  animationDuration: 0.35,
  animationStrength: 0.8,
  lineHeight: 1.4,
}

export interface CaptionStylePreset {
  id: string
  label: string
  description: string
  style: Partial<CaptionStyle>
}

export const CAPTION_STYLE_PRESETS: CaptionStylePreset[] = [
  {
    id: 'documentary',
    label: 'Documentary',
    description: 'Clean centered captions with subtle support box',
    style: {
      fontFamily: 'Arial',
      fontSize: 34,
      fontWeight: 500,
      backgroundOpacity: 0.35,
      paddingX: 28,
      paddingY: 12,
      strokeWidth: 1,
      shadowBlur: 6,
      position: 'bottom',
      alignment: 'center',
    },
  },
  {
    id: 'podcast',
    label: 'Podcast',
    description: 'Readable lower-third style with roomy line spacing',
    style: {
      fontFamily: 'Helvetica',
      fontSize: 30,
      fontWeight: 600,
      letterSpacing: 0.4,
      lineHeight: 1.5,
      backgroundOpacity: 0.5,
      paddingX: 26,
      paddingY: 14,
      maxWidthPercent: 78,
    },
  },
  {
    id: 'bold-social',
    label: 'Bold Social',
    description: 'Punchy promo style with stronger outline and motion',
    style: {
      fontFamily: 'Verdana',
      fontSize: 38,
      fontWeight: 800,
      textTransform: 'uppercase',
      strokeWidth: 3,
      backgroundOpacity: 0,
      shadowBlur: 10,
      animation: 'pop',
      animationDuration: 0.28,
      animationStrength: 1,
    },
  },
  {
    id: 'lower-third',
    label: 'Lower Third',
    description: 'Left-aligned presenter captions with anchored layout',
    style: {
      fontFamily: 'Georgia',
      fontSize: 28,
      fontWeight: 600,
      alignment: 'left',
      position: 'bottom',
      offsetX: -180,
      maxWidthPercent: 48,
      backgroundOpacity: 0.7,
      paddingX: 20,
      paddingY: 10,
    },
  },
]

// Text overlay (not tied to timeline)
export interface TextOverlay {
  id: string
  clipId?: string         // if tied to a clip, otherwise absolute
  text: string
  style: TextStyle
  position: { x: number; y: number }  // percentage 0-100
  scale: number
  rotation: number
  startTime: number
  endTime: number
  keyframes: Keyframe[]
}

export interface TextStyle {
  fontFamily: string
  fontSize: number
  fontWeight: number
  color: string
  strokeColor: string
  strokeWidth: number
  backgroundColor: string
  animation: 'none' | 'pop' | 'fade' | 'slide' | 'typewriter'
}

// Sticker overlay
export interface StickerOverlay {
  id: string
  clipId?: string
  imageUrl: string
  position: { x: number; y: number }
  scale: number
  rotation: number
  startTime: number
  endTime: number
  keyframes: Keyframe[]
}

// Media library item
export interface MediaItem {
  id: string
  name: string
  type: 'video' | 'image' | 'audio'
  url: string
  thumbnailUrl?: string
  duration: number       // for video/audio
  width?: number        // for images/video
  height?: number
  fps?: number          // frames per second (for video)
  waveformData?: number[]  // for audio - waveform visualization
  createdAt: number
}

// Export configuration
export interface ExportConfig {
  resolution: Resolution
  frameRate: number
  format: 'mp4' | 'webm'
  quality: number        // CRF: lower = better quality
  includeAudio: boolean
  audioBitrate: number  // kbps
}

// Editor tool types
export type EditorTool =
  | 'select'
  | 'blade'
  | 'trim'
  | 'text'
  | 'sticker'
  | 'pan'
  | 'zoom'

// History action for undo/redo
export interface HistoryAction {
  id: string
  type: string
  description: string
  timestamp: number
  before: EditorState
  after: EditorState
}

// Complete editor state
export interface EditorState {
  project: Project
  tracks: Track[]
  media: MediaItem[]
  overlays: (TextOverlay | StickerOverlay)[]
  captions: CaptionClip[]
  currentTime: number
  duration: number
  isPlaying: boolean
  selectedClipIds: string[]
  selectedTrackId: string | null
  zoom: number
  scrollX: number
  activeTool: EditorTool
  activePanel: 'media' | 'effects' | 'text' | 'export' | 'captions' | 'properties'
}

// Timeline display helpers
export interface TimeMarker {
  time: number
  label: string
  major: boolean
}

// Generated video assets from backend
export interface GeneratedVideo {
  id: number
  phase_of_generation: string
  output_language: string
  downloaded: boolean
  bunny_video_url: string
  bunny_audio_url: string
  has_caption_segments: boolean
  created_at: string
  error_message?: string
}

export interface VideoAssets {
  id: number
  download_url: string
  audio_url: string
  image_urls?: string[]
  image_segments?: MediaSegment[]
  audio_segments?: MediaSegment[]
  caption_segments: CaptionSegment[]
  translated_lines?: string[]
  transcription_chunks?: any[]
  transcribed_text: string
  output_language: string
}

export interface CaptionSegment {
  index: number
  text: string
  start: number
  end: number
  duration?: number
}

export interface MediaSegment {
  index?: number
  url: string
  start: number
  end: number
  duration?: number
}
