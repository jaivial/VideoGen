import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { v4 as uuidv4 } from 'uuid'
import type {
  EditorState,
  Track,
  Clip,
  CaptionClip,
  MediaItem,
  VideoClip,
  TextOverlay,
  EditorTool,
} from '../types/editor'
import { RESOLUTIONS } from '../types/editor'

interface EditorStore extends EditorState {
  // Project actions
  setProjectName: (name: string) => void
  setDuration: (duration: number) => void

  // Playback actions
  setCurrentTime: (time: number) => void
  setIsPlaying: (playing: boolean) => void
  play: () => void
  pause: () => void
  togglePlayPause: () => void

  // Track actions
  addTrack: (type: 'video' | 'audio' | 'caption', name?: string) => void
  removeTrack: (trackId: string) => void
  updateTrack: (trackId: string, updates: Partial<Track>, options?: { commit?: boolean }) => void
  reorderTracks: (startIndex: number, endIndex: number) => void

  // Clip actions
  addClip: (trackId: string, clip: Omit<Clip, 'id' | 'trackId'>) => void
  updateClip: (clipId: string, updates: Partial<Clip>, options?: { commit?: boolean }) => void
  removeClip: (clipId: string) => void
  moveClip: (clipId: string, newTrackId: string, newStartTime: number) => void
  splitClip: (clipId: string, splitTime: number) => void
  duplicateClip: (clipId: string) => void

  // Caption actions
  addCaption: (startTime: number, endTime: number, text?: string) => void
  updateCaption: (captionId: string, updates: Partial<CaptionClip>) => void
  removeCaption: (captionId: string) => void

  // Selection actions
  selectClip: (clipId: string, multi?: boolean) => void
  deselectAll: () => void
  selectTrack: (trackId: string | null) => void

  // Media actions
  addMedia: (media: Omit<MediaItem, 'id' | 'createdAt'>) => void
  removeMedia: (mediaId: string) => void

  // Overlay actions
  addTextOverlay: (overlay: Omit<TextOverlay, 'id'>) => void
  updateTextOverlay: (overlayId: string, updates: Partial<TextOverlay>) => void
  removeTextOverlay: (overlayId: string) => void

  // UI actions
  setZoom: (zoom: number) => void
  setScrollX: (scrollX: number) => void
  setActiveTool: (tool: EditorTool) => void
  setActivePanel: (panel: EditorState['activePanel']) => void

  // History actions (undo/redo)
  commitHistory: () => void
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean

  // Initialize from existing data
  initializeFromVideo: (
    videoUrl: string,
    options?: {
      duration?: number
      width?: number
      height?: number
      fps?: number
      thumbnailUrl?: string
      name?: string
      separateTracks?: boolean
      audioUrl?: string
      imageUrls?: string[]
      imageSegments?: Array<{ url?: string; start?: number; end?: number; duration?: number }>
      audioSegments?: Array<{ url?: string; start?: number; end?: number; duration?: number }>
      captionSegments?: Array<{ text?: string; start?: number; end?: number; duration?: number }>
      translatedLines?: string[]
      transcriptionChunks?: Array<{
        text?: string
        start_time?: number
        end_time?: number
        start?: number
        end?: number
        duration?: number
      }>
      transcribedText?: string
    } | number
  ) => void
}

const MAX_HISTORY = 50

const createDefaultProject = () => ({
  id: uuidv4(),
  name: 'Untitled Project',
  resolution: { width: 1920, height: 1080, label: '1080p' },
  frameRate: 30,
  duration: 0,
  createdAt: Date.now(),
  updatedAt: Date.now(),
})

const createDefaultTracks = (): Track[] => [
  {
    id: uuidv4(),
    type: 'video',
    name: 'Video 1',
    clips: [],
    muted: false,
    locked: false,
    visible: true,
    volume: 1,
    height: 80,
  },
  {
    id: uuidv4(),
    type: 'audio',
    name: 'Audio 1',
    clips: [],
    muted: false,
    locked: false,
    visible: true,
    volume: 1,
    height: 60,
  },
  {
    id: uuidv4(),
    type: 'caption',
    name: 'Captions',
    clips: [],
    muted: false,
    locked: false,
    visible: true,
    volume: 1,
    height: 50,
  },
]

const initialState: EditorState = {
  project: createDefaultProject(),
  tracks: createDefaultTracks(),
  media: [],
  overlays: [],
  captions: [],
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  selectedClipIds: [],
  selectedTrackId: null,
  zoom: 50, // pixels per second
  scrollX: 0,
  activeTool: 'select',
  activePanel: 'media',
}

// History stacks
let historyStack: EditorState[] = [initialState]
let historyIndex = 0

const saveToHistory = (state: EditorState) => {
  // Remove any redo states
  historyStack = historyStack.slice(0, historyIndex + 1)

  // Add new state
  historyStack.push(JSON.parse(JSON.stringify(state)))

  // Limit history size
  if (historyStack.length > MAX_HISTORY) {
    historyStack = historyStack.slice(-MAX_HISTORY)
  }

  historyIndex = historyStack.length - 1
}

const recalculateTimelineDuration = (state: EditorState) => {
  let maxEnd = 0
  for (const track of state.tracks) {
    for (const clip of track.clips) {
      const clipEnd = clip.startTime + clip.duration
      if (clipEnd > maxEnd) maxEnd = clipEnd
    }
  }

  state.duration = maxEnd
  state.project.duration = maxEnd
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

const normalizeClipTiming = (clip: Clip, updates: Partial<Clip>) => {
  // Only enforce timing normalization when editing the source range or playback rate.
  const touchedTiming = 'trimStart' in updates || 'trimEnd' in updates || 'speed' in updates
  const touchedDurationExplicitly = 'duration' in updates

  if (clip.type === 'video' || clip.type === 'image') {
    const anyClip = clip as any
    const originalDuration: number | undefined = anyClip.originalDuration

    const speed = clamp(Number(anyClip.speed ?? 1), 0.25, 4)
    anyClip.speed = speed

    const minSource = 0.05
    const maxSource = typeof originalDuration === 'number' && originalDuration > 0 ? originalDuration : Number.POSITIVE_INFINITY
    clip.trimStart = clamp(Number(clip.trimStart ?? 0), 0, maxSource)
    clip.trimEnd = clamp(Number(clip.trimEnd ?? 0), 0, maxSource)
    if (clip.trimEnd < clip.trimStart+ minSource) {
      clip.trimEnd = clamp(clip.trimStart + minSource, 0, maxSource)
    }

    if (touchedTiming && !touchedDurationExplicitly) {
      const sourceLen = Math.max(minSource, clip.trimEnd - clip.trimStart)
      clip.duration = Math.max(0.05, sourceLen / speed)
    }
  }

  if (clip.type === 'audio') {
    const minSource = 0.05
    clip.trimStart = Math.max(0, Number(clip.trimStart ?? 0))
    clip.trimEnd = Math.max(clip.trimStart + minSource, Number(clip.trimEnd ?? 0))

    if (touchedTiming && !touchedDurationExplicitly) {
      clip.duration = Math.max(0.05, clip.trimEnd - clip.trimStart)
    }
  }

  if (clip.type === 'caption') {
    clip.duration = Math.max(0.05, Number(clip.duration ?? 0))
    clip.startTime = Math.max(0, Number(clip.startTime ?? 0))
  }
}

const createDefaultCaptionStyle = () => ({
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
  position: 'bottom' as const,
  alignment: 'center' as const,
  animation: 'fade' as const,
  lineHeight: 1.4,
})

const splitCaptionLines = (translatedLines?: string[], transcribedText?: string): string[] => {
  const fromTranslated = (translatedLines || [])
    .map((line) => String(line || '').replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
  if (fromTranslated.length > 0) return fromTranslated

  const source = String(transcribedText || '').trim()
  if (!source) return []

  const fromText = source
    .split(/\n+|(?<=[.!?])\s+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
  return fromText
}

const buildCaptionSegmentsForInit = (
  duration: number,
  options: {
    captionSegments?: Array<{ text?: string; start?: number; end?: number; duration?: number }>
    translatedLines?: string[]
    transcriptionChunks?: Array<{
      text?: string
      start_time?: number
      end_time?: number
      start?: number
      end?: number
      duration?: number
    }>
    transcribedText?: string
  }
) => {
  const clampedDuration = Math.max(0.1, Number(duration) || 0.1)

  const explicitSegments = (options.captionSegments || [])
    .map((segment) => {
      const text = String(segment.text || '').trim()
      const start = Math.max(0, Number(segment.start ?? 0) || 0)
      let end = Number(segment.end ?? 0) || 0
      const segDur = Number(segment.duration ?? 0) || 0
      if (end <= start && segDur > 0) end = start + segDur
      return { text, start, end }
    })
    .filter((segment) => segment.text.length > 0 && segment.end > segment.start)

  if (explicitSegments.length > 0) {
    return explicitSegments
  }

  const lines = splitCaptionLines(options.translatedLines, options.transcribedText)
  if (lines.length === 0) return []

  const chunks = (options.transcriptionChunks || []).map((chunk) => {
    const rawStart = chunk.start_time ?? chunk.start ?? 0
    const rawEnd = chunk.end_time ?? chunk.end ?? 0
    const start = Math.max(0, Number(rawStart) || 0)
    let end = Number(rawEnd) || 0
    const chunkDuration = Number(chunk.duration ?? 0) || 0
    if (end <= start && chunkDuration > 0) end = start + chunkDuration
    return {
      text: String(chunk.text || '').trim(),
      start,
      end,
    }
  })

  const hasValidChunkTimes = chunks.some((chunk) => chunk.end > chunk.start)
  if (hasValidChunkTimes) {
    const fromChunks = lines
      .map((text, index) => {
        const chunk = chunks[index]
        if (!chunk || chunk.end <= chunk.start) return null
        return {
          text,
          start: chunk.start,
          end: chunk.end,
        }
      })
      .filter((segment): segment is { text: string; start: number; end: number } => Boolean(segment))

    if (fromChunks.length > 0) return fromChunks
  }

  const slotDuration = clampedDuration / lines.length
  return lines.map((text, index) => {
    const start = index * slotDuration
    const end = index === lines.length - 1 ? clampedDuration : (index + 1) * slotDuration
    return { text, start, end }
  })
}

export const useEditorStore = create<EditorStore>()(
  immer((set) => ({
    ...initialState,

    // Project
    setProjectName: (name) =>
      set((state) => {
        state.project.name = name
        state.project.updatedAt = Date.now()
      }),

    setDuration: (duration) =>
      set((state) => {
        state.duration = duration
        state.project.duration = duration
      }),

    // Playback
    setCurrentTime: (time) =>
      set((state) => {
        state.currentTime = Math.max(0, Math.min(time, state.duration))
      }),

    setIsPlaying: (playing) =>
      set((state) => {
        state.isPlaying = playing
      }),

    play: () => set({ isPlaying: true }),
    pause: () => set({ isPlaying: false }),
    togglePlayPause: () =>
      set((state) => {
        state.isPlaying = !state.isPlaying
      }),

    // Tracks
    addTrack: (type, name) =>
      set((state) => {
        const trackCount = state.tracks.filter((t) => t.type === type).length + 1
        const defaultNames = {
          video: 'Video',
          audio: 'Audio',
          caption: 'Captions',
        }
        const newTrack: Track = {
          id: uuidv4(),
          type,
          name: name || `${defaultNames[type]} ${trackCount}`,
          clips: [],
          muted: false,
          locked: false,
          visible: true,
          volume: 1,
          height: type === 'video' ? 80 : type === 'audio' ? 60 : 50,
        }
        state.tracks.push(newTrack)
        saveToHistory(state)
      }),

    removeTrack: (trackId) =>
      set((state) => {
        state.tracks = state.tracks.filter((t) => t.id !== trackId)
        saveToHistory(state)
      }),

    updateTrack: (trackId, updates, options) =>
      set((state) => {
        const commit = options?.commit ?? true
        const track = state.tracks.find((t) => t.id === trackId)
        if (track) {
          Object.assign(track, updates)
        }
        if (commit) saveToHistory(state)
      }),

    reorderTracks: (startIndex, endIndex) =>
      set((state) => {
        const [removed] = state.tracks.splice(startIndex, 1)
        state.tracks.splice(endIndex, 0, removed)
        saveToHistory(state)
      }),

    // Clips
    addClip: (trackId, clipData) =>
      set((state) => {
        const track = state.tracks.find((t) => t.id === trackId)
        if (track) {
          const newClip: Clip = {
            ...clipData,
            id: uuidv4(),
            trackId,
          } as Clip
          track.clips.push(newClip)

          // Update duration if needed
          const clipEnd = newClip.startTime + newClip.duration
          if (clipEnd > state.duration) {
            state.duration = clipEnd
            state.project.duration = clipEnd
          }

          saveToHistory(state)
        }
      }),

    updateClip: (clipId, updates, options) =>
      set((state) => {
        const commit = options?.commit ?? true
        for (const track of state.tracks) {
          const clip = track.clips.find((c) => c.id === clipId)
          if (clip) {
            Object.assign(clip, updates)
            normalizeClipTiming(clip as Clip, updates)

            recalculateTimelineDuration(state)
            break
          }
        }
        if (commit) saveToHistory(state)
      }),

    removeClip: (clipId) =>
      set((state) => {
        for (const track of state.tracks) {
          const index = track.clips.findIndex((c) => c.id === clipId)
          if (index !== -1) {
            track.clips.splice(index, 1)
            break
          }
        }
        state.selectedClipIds = state.selectedClipIds.filter((id) => id !== clipId)
        recalculateTimelineDuration(state)
        saveToHistory(state)
      }),

    moveClip: (clipId, newTrackId, newStartTime) =>
      set((state) => {
        let clip: Clip | undefined

        // Find and remove clip from current track
        for (const track of state.tracks) {
          const index = track.clips.findIndex((c) => c.id === clipId)
          if (index !== -1) {
            clip = track.clips[index] as Clip
            track.clips.splice(index, 1)
            break
          }
        }

        if (clip) {
          // Add to new track
          const newTrack = state.tracks.find((t) => t.id === newTrackId)
          if (newTrack) {
            clip.trackId = newTrackId
            clip.startTime = newStartTime
            newTrack.clips.push(clip)
          }
        }

        recalculateTimelineDuration(state)
        saveToHistory(state)
      }),

    splitClip: (clipId, splitTime) =>
      set((state) => {
        for (const track of state.tracks) {
          const clipIndex = track.clips.findIndex((c) => c.id === clipId)
          if (clipIndex !== -1) {
            const clip = track.clips[clipIndex] as Clip
            const relativeTime = splitTime - clip.startTime

            if (relativeTime > 0 && relativeTime < clip.duration) {
              // Create second clip
              const secondClip: Clip = {
                ...clip,
                id: uuidv4(),
                startTime: splitTime,
                duration: clip.duration - relativeTime,
                trimStart: clip.trimStart + relativeTime,
              }

              // Modify first clip
              clip.duration = relativeTime
              clip.trimEnd = clip.trimStart + relativeTime

              // Insert second clip after first
              track.clips.splice(clipIndex + 1, 0, secondClip as Clip)
              recalculateTimelineDuration(state)
              saveToHistory(state)
            }
            break
          }
        }
      }),

    duplicateClip: (clipId) =>
      set((state) => {
        for (const track of state.tracks) {
          const clipIndex = track.clips.findIndex((c) => c.id === clipId)
          if (clipIndex !== -1) {
            const clip = track.clips[clipIndex]
            const newClip: Clip = {
              ...clip,
              id: uuidv4(),
              startTime: clip.startTime + clip.duration,
            }
            track.clips.splice(clipIndex + 1, 0, newClip as Clip)
            recalculateTimelineDuration(state)
            saveToHistory(state)
            break
          }
        }
      }),

    // Captions
    addCaption: (startTime, endTime, text = 'New caption') =>
      set((state) => {
        const captionTrack = state.tracks.find((t) => t.type === 'caption')
        if (captionTrack) {
          const newCaption: CaptionClip = {
            id: uuidv4(),
            trackId: captionTrack.id,
            mediaId: '',
            name: text,
            type: 'caption',
            startTime,
            duration: endTime - startTime,
            trimStart: 0,
            trimEnd: endTime - startTime,
            url: '',
            text,
            style: {
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
            },
          }
          captionTrack.clips.push(newCaption)

          const clipEnd = newCaption.startTime + newCaption.duration
          if (clipEnd > state.duration) {
            state.duration = clipEnd
            state.project.duration = clipEnd
          }

          saveToHistory(state)
        }
      }),

    updateCaption: (captionId, updates) =>
      set((state) => {
        for (const track of state.tracks) {
          const caption = track.clips.find((c) => c.id === captionId) as CaptionClip | undefined
          if (caption && caption.type === 'caption') {
            Object.assign(caption, updates)
            break
          }
        }
      }),

    removeCaption: (captionId) =>
      set((state) => {
        for (const track of state.tracks) {
          const index = track.clips.findIndex((c) => c.id === captionId)
          if (index !== -1) {
            track.clips.splice(index, 1)
            break
          }
        }
        recalculateTimelineDuration(state)
        saveToHistory(state)
      }),

    // Selection
    selectClip: (clipId, multi = false) =>
      set((state) => {
        if (multi) {
          if (state.selectedClipIds.includes(clipId)) {
            state.selectedClipIds = state.selectedClipIds.filter((id) => id !== clipId)
          } else {
            state.selectedClipIds.push(clipId)
          }
        } else {
          state.selectedClipIds = [clipId]
        }
      }),

    deselectAll: () =>
      set((state) => {
        state.selectedClipIds = []
      }),

    selectTrack: (trackId) =>
      set((state) => {
        state.selectedTrackId = trackId
      }),

    // Media
    addMedia: (mediaData) =>
      set((state) => {
        const newMedia: MediaItem = {
          ...mediaData,
          id: uuidv4(),
          createdAt: Date.now(),
        }
        state.media.push(newMedia)
      }),

    removeMedia: (mediaId) =>
      set((state) => {
        const mediaItem = state.media.find((m) => m.id === mediaId)
        if (mediaItem?.url?.startsWith('blob:') && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
          try {
            URL.revokeObjectURL(mediaItem.url)
          } catch {
            // Ignore revoke failures
          }
        }
        state.media = state.media.filter((m) => m.id !== mediaId)
      }),

    // Overlays
    addTextOverlay: (overlayData) =>
      set((state) => {
        const newOverlay: TextOverlay = {
          ...overlayData,
          id: uuidv4(),
        }
        state.overlays.push(newOverlay)
      }),

    updateTextOverlay: (overlayId, updates) =>
      set((state) => {
        const overlay = state.overlays.find((o) => o.id === overlayId)
        if (overlay && 'text' in overlay) {
          Object.assign(overlay, updates)
        }
      }),

    removeTextOverlay: (overlayId) =>
      set((state) => {
        state.overlays = state.overlays.filter((o) => o.id !== overlayId)
      }),

    // UI
    setZoom: (zoom) =>
      set((state) => {
        state.zoom = Math.max(10, Math.min(150, zoom))
      }),

    setScrollX: (scrollX) =>
      set((state) => {
        state.scrollX = Math.max(0, scrollX)
      }),

    setActiveTool: (tool) =>
      set((state) => {
        state.activeTool = tool
      }),

    setActivePanel: (panel) =>
      set((state) => {
        state.activePanel = panel
      }),

    // History
    commitHistory: () =>
      set((state) => {
        saveToHistory(state)
      }),
    undo: () => {
      if (historyIndex > 0) {
        historyIndex--
        const prevState = historyStack[historyIndex]
        set(() => ({ ...prevState }))
      }
    },

    redo: () => {
      if (historyIndex < historyStack.length - 1) {
        historyIndex++
        const nextState = historyStack[historyIndex]
        set(() => ({ ...nextState }))
      }
    },

    canUndo: () => historyIndex > 0,

    canRedo: () => historyIndex < historyStack.length - 1,

    // Initialize
    initializeFromVideo: (videoUrl, options = {}) =>
      set((state) => {
        const normalizedOptions =
          typeof options === 'number' ? { duration: options } : options

        const {
          duration = 60,
          width,
          height,
          fps,
          thumbnailUrl,
          name = 'Imported Video',
          separateTracks = false,
          audioUrl,
          imageUrls = [],
          imageSegments = [],
          audioSegments = [],
          captionSegments = [],
          translatedLines = [],
          transcriptionChunks = [],
          transcribedText = '',
        } = normalizedOptions
        let derivedDuration = Math.max(0, duration)

        // Create media item with full metadata
        const mediaId = uuidv4()
        const mediaItem: MediaItem = {
          id: mediaId,
          name,
          type: 'video',
          url: videoUrl,
          thumbnailUrl,
          duration,
          width,
          height,
          fps,
          createdAt: Date.now(),
        }

        // Add to media library
        state.media.push(mediaItem)

        // Update project resolution if width/height available
        if (width && height) {
          // Find closest matching resolution
          const matchingResolution = RESOLUTIONS.find(
            (r) => r.width === width && r.height === height
          )
          if (matchingResolution) {
            state.project.resolution = matchingResolution
          } else {
            // Use actual dimensions
            state.project.resolution = {
              width,
              height,
              label: `${width}x${height}`,
            }
          }
        }

        // Update project frame rate if available
        if (fps) {
          state.project.frameRate = fps
        }

        // Create visual clips on first video track.
        const videoTrack = state.tracks.find((t) => t.type === 'video')
        if (videoTrack) {
          const visualImageSegments = separateTracks
            ? imageSegments
              .map((segment, index) => {
                const url = String(segment.url || '').trim()
                if (!url) return null
                const start = Math.max(0, Number(segment.start ?? 0) || 0)
                let end = Number(segment.end ?? 0) || 0
                const segmentDuration = Number(segment.duration ?? 0) || 0
                if (end <= start && segmentDuration > 0) end = start + segmentDuration
                if (end <= start) end = start + 0.05
                return { url, start, end, index }
              })
              .filter((segment): segment is { url: string; start: number; end: number; index: number } => Boolean(segment))
            : []
          const visualImageURLs = separateTracks ? imageUrls.filter((url) => typeof url === 'string' && url.trim().length > 0) : []

          if (visualImageSegments.length > 0) {
            visualImageSegments.forEach((segment, index) => {
              const imageMediaID = uuidv4()
              const clipDuration = Math.max(0.05, segment.end - segment.start)
              state.media.push({
                id: imageMediaID,
                name: `${name} • Image ${index + 1}`,
                type: 'image',
                url: segment.url,
                thumbnailUrl: segment.url,
                duration: clipDuration,
                width,
                height,
                createdAt: Date.now(),
              })

              const imageClip: VideoClip = {
                id: uuidv4(),
                trackId: videoTrack.id,
                mediaId: imageMediaID,
                name: `Image ${index + 1}`,
                type: 'image',
                startTime: segment.start,
                duration: clipDuration,
                trimStart: 0,
                trimEnd: clipDuration,
                url: segment.url,
                thumbnailUrl: segment.url,
                volume: 0,
                speed: 1,
                volumeKeyframes: [],
                speedKeyframes: [],
                effects: [],
                originalWidth: width,
                originalHeight: height,
                originalDuration: clipDuration,
                originalFps: fps,
              }
              derivedDuration = Math.max(derivedDuration, segment.start + clipDuration)
              videoTrack.clips.push(imageClip)
            })
          } else if (visualImageURLs.length > 0) {
            const perClip = Math.max(0.05, duration / visualImageURLs.length)

            visualImageURLs.forEach((imageURL, index) => {
              const imageMediaID = uuidv4()
              const start = index * perClip
              const clipDuration = index === visualImageURLs.length - 1
                ? Math.max(0.05, duration - start)
                : perClip

              state.media.push({
                id: imageMediaID,
                name: `${name} • Image ${index + 1}`,
                type: 'image',
                url: imageURL,
                thumbnailUrl: imageURL,
                duration: clipDuration,
                width,
                height,
                createdAt: Date.now(),
              })

              const imageClip: VideoClip = {
                id: uuidv4(),
                trackId: videoTrack.id,
                mediaId: imageMediaID,
                name: `Image ${index + 1}`,
                type: 'image',
                startTime: start,
                duration: clipDuration,
                trimStart: 0,
                trimEnd: clipDuration,
                url: imageURL,
                thumbnailUrl: imageURL,
                volume: 0,
                speed: 1,
                volumeKeyframes: [],
                speedKeyframes: [],
                effects: [],
                originalWidth: width,
                originalHeight: height,
                originalDuration: clipDuration,
                originalFps: fps,
              }
              derivedDuration = Math.max(derivedDuration, start + clipDuration)
              videoTrack.clips.push(imageClip)
            })
          } else {
            const newClip: VideoClip = {
              id: uuidv4(),
              trackId: videoTrack.id,
              mediaId,
              name,
              type: 'video',
              startTime: 0,
              duration,
              trimStart: 0,
              trimEnd: duration,
              url: videoUrl,
              thumbnailUrl,
              volume: separateTracks ? 0 : 1,
              speed: 1,
              volumeKeyframes: [],
              speedKeyframes: [],
              effects: [],
              // Store original media properties
              originalWidth: width,
              originalHeight: height,
              originalDuration: duration,
              originalFps: fps,
            }
            derivedDuration = Math.max(derivedDuration, duration)
            videoTrack.clips.push(newClip)
          }
        }

        if (separateTracks) {
          // Create independent audio clip.
          const audioTrack = state.tracks.find((t) => t.type === 'audio')
          const resolvedAudioURL = audioUrl || videoUrl
          if (audioTrack && resolvedAudioURL) {
            const timedAudioSegments = audioSegments
              .map((segment, index) => {
                const segmentURL = String(segment.url || resolvedAudioURL).trim()
                if (!segmentURL) return null
                const start = Math.max(0, Number(segment.start ?? 0) || 0)
                let end = Number(segment.end ?? 0) || 0
                const segmentDuration = Number(segment.duration ?? 0) || 0
                if (end <= start && segmentDuration > 0) end = start + segmentDuration
                if (end <= start) end = start + 0.05
                return { url: segmentURL, start, end, index }
              })
              .filter((segment): segment is { url: string; start: number; end: number; index: number } => Boolean(segment))

            if (timedAudioSegments.length > 0) {
              timedAudioSegments.forEach((segment, index) => {
                const clipDuration = Math.max(0.05, segment.end - segment.start)
                const audioMediaID = uuidv4()
                state.media.push({
                  id: audioMediaID,
                  name: `${name} • Audio ${index + 1}`,
                  type: 'audio',
                  url: segment.url,
                  duration: clipDuration,
                  createdAt: Date.now(),
                })
                audioTrack.clips.push({
                  id: uuidv4(),
                  trackId: audioTrack.id,
                  mediaId: audioMediaID,
                  name: `${name} Audio ${index + 1}`,
                  type: 'audio',
                  startTime: segment.start,
                  duration: clipDuration,
                  trimStart: segment.start,
                  trimEnd: segment.end,
                  url: segment.url,
                  volume: 1,
                  fadeIn: 0,
                  fadeOut: 0,
                  volumeKeyframes: [],
                  effects: [],
                  waveformData: [],
                })
                derivedDuration = Math.max(derivedDuration, segment.start + clipDuration)
              })
            } else {
              const fallbackCaptionAudioSegments = buildCaptionSegmentsForInit(duration, {
                captionSegments,
                translatedLines,
                transcriptionChunks,
                transcribedText,
              })

              if (fallbackCaptionAudioSegments.length > 0) {
                fallbackCaptionAudioSegments.forEach((segment, index) => {
                  const clipDuration = Math.max(0.05, segment.end - segment.start)
                  const audioMediaID = uuidv4()
                  state.media.push({
                    id: audioMediaID,
                    name: `${name} • Audio ${index + 1}`,
                    type: 'audio',
                    url: resolvedAudioURL,
                    duration: clipDuration,
                    createdAt: Date.now(),
                  })
                  audioTrack.clips.push({
                    id: uuidv4(),
                    trackId: audioTrack.id,
                    mediaId: audioMediaID,
                    name: `${name} Audio ${index + 1}`,
                    type: 'audio',
                    startTime: segment.start,
                    duration: clipDuration,
                    trimStart: segment.start,
                    trimEnd: segment.end,
                    url: resolvedAudioURL,
                    volume: 1,
                    fadeIn: 0,
                    fadeOut: 0,
                    volumeKeyframes: [],
                    effects: [],
                    waveformData: [],
                  })
                  derivedDuration = Math.max(derivedDuration, segment.start + clipDuration)
                })
              } else {
                const audioMediaID = uuidv4()
                state.media.push({
                  id: audioMediaID,
                  name: `${name} • Audio`,
                  type: 'audio',
                  url: resolvedAudioURL,
                  duration,
                  createdAt: Date.now(),
                })
                audioTrack.clips.push({
                  id: uuidv4(),
                  trackId: audioTrack.id,
                  mediaId: audioMediaID,
                  name: `${name} Audio`,
                  type: 'audio',
                  startTime: 0,
                  duration,
                  trimStart: 0,
                  trimEnd: duration,
                  url: resolvedAudioURL,
                  volume: 1,
                  fadeIn: 0,
                  fadeOut: 0,
                  volumeKeyframes: [],
                  effects: [],
                  waveformData: [],
                })
                derivedDuration = Math.max(derivedDuration, duration)
              }
            }
          }

          // Create independent caption clips.
          const captionTrack = state.tracks.find((t) => t.type === 'caption')
          if (captionTrack) {
            const segments = buildCaptionSegmentsForInit(duration, {
              captionSegments,
              translatedLines,
              transcriptionChunks,
              transcribedText,
            })

            segments.forEach((segment, index) => {
              const captionDuration = Math.max(0.05, segment.end - segment.start)
              const captionMediaID = uuidv4()
              captionTrack.clips.push({
                id: uuidv4(),
                trackId: captionTrack.id,
                mediaId: captionMediaID,
                name: `Caption ${index + 1}`,
                type: 'caption',
                startTime: segment.start,
                duration: captionDuration,
                trimStart: 0,
                trimEnd: captionDuration,
                url: '',
                text: segment.text,
                style: createDefaultCaptionStyle(),
              } as CaptionClip)
              derivedDuration = Math.max(derivedDuration, segment.start + captionDuration)
            })
          }
        }

        state.duration = derivedDuration
        state.project.duration = derivedDuration
        state.project.name = name

        // Reset history
        historyStack = [JSON.parse(JSON.stringify(state))]
        historyIndex = 0
      }),
  }))
)

// Utility hooks
export const useCurrentTime = () => useEditorStore((s) => s.currentTime)
export const useIsPlaying = () => useEditorStore((s) => s.isPlaying)
export const useDuration = () => useEditorStore((s) => s.duration)
export const useTracks = () => useEditorStore((s) => s.tracks)
export const useSelectedClips = () => useEditorStore((s) => s.selectedClipIds)
export const useZoom = () => useEditorStore((s) => s.zoom)
export const useActiveTool = () => useEditorStore((s) => s.activeTool)
export const useActivePanel = () => useEditorStore((s) => s.activePanel)

// Selectors
export const useClip = (clipId: string) =>
  useEditorStore((state) => {
    for (const track of state.tracks) {
      const clip = track.clips.find((c) => c.id === clipId)
      if (clip) return clip
    }
    return null
  })

export const useTrack = (trackId: string) =>
  useEditorStore((state) => state.tracks.find((t) => t.id === trackId))

export const useMediaItem = (mediaId: string) =>
  useEditorStore((state) => state.media.find((m) => m.id === mediaId))
