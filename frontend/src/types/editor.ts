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
export interface CaptionStyle {
  fontFamily: string
  fontSize: number
  fontWeight: number
  color: string
  backgroundColor: string
  backgroundOpacity: number
  strokeColor: string
  strokeWidth: number
  shadowColor: string
  shadowBlur: number
  shadowOffsetX: number
  shadowOffsetY: number
  position: 'top' | 'center' | 'bottom'
  alignment: 'left' | 'center' | 'right'
  animation: 'none' | 'fade' | 'typewriter' | 'pop' | 'slide-up' | 'slide-down'
  lineHeight: number
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontFamily: 'Arial',
  fontSize: 32,
  fontWeight: 400,
  color: '#ffffff',
  backgroundColor: '#000000',
  backgroundOpacity: 0,
  strokeColor: '#000000',
  strokeWidth: 2,
  shadowColor: '#000000',
  shadowBlur: 4,
  shadowOffsetX: 2,
  shadowOffsetY: 2,
  position: 'bottom',
  alignment: 'center',
  animation: 'fade',
  lineHeight: 1.4,
}

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
  activePanel: 'media' | 'effects' | 'text' | 'export' | 'captions'
}

// Timeline display helpers
export interface TimeMarker {
  time: number
  label: string
  major: boolean
}
