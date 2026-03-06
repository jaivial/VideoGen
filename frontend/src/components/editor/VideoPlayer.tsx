import { useRef, useEffect, useCallback, useMemo, useState } from 'react'
import { useEditorStore, useCurrentTime, useIsPlaying, useDuration } from '../../stores/editorStore'
import { getCaptionPreviewState } from './captionPreview'

interface VideoPlayerProps {
  className?: string
}

const EMPTY_CLIPS: any[] = []

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function getEffectValue(clip: any, type: string, fallback = 0): number {
  const effects = Array.isArray(clip?.effects) ? clip.effects : []
  const match = effects.find((effect: any) => effect?.type === type && effect?.enabled !== false)
  const value = Number(match?.params?.value)
  return Number.isFinite(value) ? value : fallback
}

function getVisualFilterCSS(clip: any): string {
  if (!clip || (clip.type !== 'video' && clip.type !== 'image')) return ''

  const brightness = getEffectValue(clip, 'brightness', 0)
  const contrast = getEffectValue(clip, 'contrast', 0)
  const saturation = getEffectValue(clip, 'saturation', 0)
  const blur = getEffectValue(clip, 'blur', 0)

  const cssParts: string[] = []
  if (brightness !== 0) cssParts.push(`brightness(${clamp(100 + brightness, 0, 250)}%)`)
  if (contrast !== 0) cssParts.push(`contrast(${clamp(100 + contrast, 0, 300)}%)`)
  if (saturation !== 0) cssParts.push(`saturate(${clamp(100 + saturation, 0, 300)}%)`)
  if (blur > 0) cssParts.push(`blur(${clamp(blur / 4, 0, 10).toFixed(2)}px)`)

  return cssParts.join(' ')
}

export function VideoPlayer({ className = '' }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const switchingClipRef = useRef(false)
  const switchingAudioRef = useRef(false)
  const imageRafRef = useRef<number | null>(null)
  const imageLastTsRef = useRef<number | null>(null)
  const currentTimeRef = useRef(0)

  const currentTime = useCurrentTime()
  const isPlaying = useIsPlaying()
  const duration = useDuration()
  const project = useEditorStore((state) => state.project)
  const totalClips = useEditorStore((state) => state.tracks.reduce((count, track) => count + track.clips.length, 0))

  const { setCurrentTime, setIsPlaying, togglePlayPause } = useEditorStore()

  useEffect(() => {
    currentTimeRef.current = currentTime
  }, [currentTime])

  const videoTrackClips = useEditorStore((state) => state.tracks.find((t) => t.type === 'video')?.clips ?? EMPTY_CLIPS)
  const audioTrack = useEditorStore((state) => state.tracks.find((t) => t.type === 'audio') ?? null)
  const audioTrackClips = useEditorStore((state) => state.tracks.find((t) => t.type === 'audio')?.clips ?? EMPTY_CLIPS)
  const captionTrackClips = useEditorStore((state) => state.tracks.find((t) => t.type === 'caption')?.clips ?? EMPTY_CLIPS)
  const visualClips = useMemo(() => {
    return [...videoTrackClips]
      .filter((c: any) => c.type === 'video' || c.type === 'image')
      .sort((a: any, b: any) => a.startTime - b.startTime)
  }, [videoTrackClips])
  const audioClips = useMemo(() => {
    return [...audioTrackClips]
      .filter((c: any) => c.type === 'audio')
      .sort((a: any, b: any) => a.startTime - b.startTime)
  }, [audioTrackClips])
  const captionClips = useMemo(() => {
    return [...captionTrackClips].filter((clip: any) => clip.type === 'caption')
  }, [captionTrackClips])
  const activeCaptions = useMemo(() => {
    return captionClips
      .filter((clip: any) => {
        const start = Number(clip.startTime ?? 0)
        const duration = Math.max(0, Number(clip.duration ?? 0))
        const end = start + duration
        return (
          typeof clip.text === 'string' &&
          clip.text.trim().length > 0 &&
          currentTime >= start &&
          currentTime < end
        )
      })
      .sort((a: any, b: any) => a.startTime - b.startTime)
  }, [captionClips, currentTime])

  const activeClip = (() => {
    for (const clip of visualClips as any[]) {
      if (currentTime >= clip.startTime && currentTime < clip.startTime + clip.duration) {
        return clip
      }
    }
    return null
  })()
  const activeAudioClip = (() => {
    for (const clip of audioClips as any[]) {
      if (currentTime >= clip.startTime && currentTime < clip.startTime + clip.duration) {
        return clip
      }
    }
    return null
  })()

  const visualClipsRef = useRef<any[]>([])
  useEffect(() => {
    visualClipsRef.current = visualClips as any[]
  }, [visualClips])

  const getSourceTimeForTimeline = (clip: any, timelineTime: number) => {
    const speed = Number(clip.speed ?? 1) || 1
    const offset = Math.max(0, timelineTime - clip.startTime)
    return Number(clip.trimStart ?? 0) + offset * speed
  }

  const getTimelineTimeForSource = (clip: any, sourceTime: number) => {
    const speed = Number(clip.speed ?? 1) || 1
    const offset = (sourceTime - Number(clip.trimStart ?? 0)) / speed
    return clip.startTime + Math.max(0, offset)
  }
  const getAudioSourceTimeForTimeline = (clip: any, timelineTime: number) => {
    const offset = Math.max(0, timelineTime - clip.startTime)
    return Number(clip.trimStart ?? 0) + offset
  }

  const syncVideoToTimeline = useCallback(async () => {
    const video = videoRef.current
    if (!video) return

    if (!activeClip || activeClip.type !== 'video') {
      video.pause()
      if (isPlaying && !activeClip) setIsPlaying(false)
      return
    }

    const desiredSrc = activeClip.url
    const desiredTime = getSourceTimeForTimeline(activeClip, currentTime)
    const desiredRate = Math.max(0.25, Math.min(4, Number(activeClip.speed ?? 1) || 1))

    const needsSrcChange = video.src !== desiredSrc
    const needsSeek = Math.abs(video.currentTime - desiredTime) > 0.15

    if (needsSrcChange) {
      switchingClipRef.current = true
      video.src = desiredSrc
      video.load()
      await new Promise<void>((resolve) => {
        const onLoaded = () => {
          video.removeEventListener('loadedmetadata', onLoaded)
          resolve()
        }
        video.addEventListener('loadedmetadata', onLoaded)
      })
      switchingClipRef.current = false
    }

    if (video.playbackRate !== desiredRate) {
      try {
        video.playbackRate = desiredRate
      } catch {
        // ignore
      }
    }

    if (needsSeek) {
      try {
        video.currentTime = desiredTime
      } catch {
        // ignore
      }
    }

    if (isPlaying) {
      const playResult = video.play()
      if (playResult && typeof (playResult as any).catch === 'function') {
        ;(playResult as any).catch(() => {})
      }
    } else {
      video.pause()
    }
  }, [activeClip, currentTime, isPlaying, setIsPlaying])

  // Sync video element to timeline (cuts/trims/speed)
  useEffect(() => {
    syncVideoToTimeline()
  }, [syncVideoToTimeline])

  const syncAudioToTimeline = useCallback(async () => {
    const audio = audioRef.current
    if (!audio) return

    if (!activeAudioClip || !activeAudioClip.url) {
      audio.pause()
      return
    }

    const desiredSrc = activeAudioClip.url
    const desiredTime = getAudioSourceTimeForTimeline(activeAudioClip, currentTime)
    const needsSrcChange = audio.src !== desiredSrc
    const needsSeek = Math.abs(audio.currentTime - desiredTime) > 0.2
    const clipVolume = clamp(Number(activeAudioClip.volume ?? 1), 0, 1)
    const trackVolume = clamp(Number(audioTrack?.volume ?? 1), 0, 1)
    const isTrackMuted = Boolean(audioTrack?.muted)
    const effectiveVolume = isTrackMuted ? 0 : clipVolume * trackVolume

    if (needsSrcChange) {
      switchingAudioRef.current = true
      audio.src = desiredSrc
      audio.load()
      await new Promise<void>((resolve) => {
        const onLoaded = () => {
          audio.removeEventListener('loadedmetadata', onLoaded)
          resolve()
        }
        audio.addEventListener('loadedmetadata', onLoaded)
      })
      switchingAudioRef.current = false
    }

    audio.volume = effectiveVolume

    if (needsSeek && !switchingAudioRef.current) {
      try {
        audio.currentTime = desiredTime
      } catch {
        // ignore
      }
    }

    if (isPlaying) {
      const playResult = audio.play()
      if (playResult && typeof (playResult as any).catch === 'function') {
        ;(playResult as any).catch(() => {})
      }
    } else {
      audio.pause()
    }
  }, [activeAudioClip, currentTime, isPlaying, audioTrack])

  useEffect(() => {
    syncAudioToTimeline()
  }, [syncAudioToTimeline])

  useEffect(() => {
    return () => {
      const audio = audioRef.current
      if (audio) audio.pause()
    }
  }, [])

  // Update timeline time based on video time while playing
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handleTimeUpdate = () => {
      if (!activeClip || activeClip.type !== 'video' || switchingClipRef.current) return
      const timelineTime = getTimelineTimeForSource(activeClip, video.currentTime)

      // Clamp within the clip bounds for stability
      const clipEnd = activeClip.startTime + activeClip.duration
      const clamped = Math.max(activeClip.startTime, Math.min(timelineTime, clipEnd))
      setCurrentTime(clamped)

      // Jump to next clip when we reach the end of this one
      const epsilon = 0.03
      const sourceEnd = Number(activeClip.trimEnd ?? (Number(activeClip.trimStart ?? 0) + activeClip.duration)) - epsilon
      if (video.currentTime >= sourceEnd || clamped >= clipEnd - epsilon) {
        const idx = (visualClips as any[]).findIndex((c) => c.id === activeClip.id)
        const next = idx >= 0 ? (visualClips as any[])[idx + 1] : null
        if (!next) {
          setIsPlaying(false)
          return
        }
        // Skip gaps (blank timeline) for now
        setCurrentTime(next.startTime)
      }
    }

    video.addEventListener('timeupdate', handleTimeUpdate)
    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate)
    }
  }, [activeClip, visualClips, setCurrentTime, setIsPlaying])

  // Basic image clip playback (advance timeline while showing still image)
  useEffect(() => {
    if (!activeClip || activeClip.type !== 'image' || !isPlaying) return

    const tick = (ts: number) => {
      if (imageLastTsRef.current == null) imageLastTsRef.current = ts
      const dt = (ts - imageLastTsRef.current) / 1000
      imageLastTsRef.current = ts

      const nextTime = currentTimeRef.current + dt
      const clipEnd = activeClip.startTime + activeClip.duration

      if (nextTime >= clipEnd - 0.01) {
        const clips = visualClipsRef.current
        const idx = clips.findIndex((c) => c.id === activeClip.id)
        const next = idx >= 0 ? clips[idx + 1] : null
        if (!next) {
          setIsPlaying(false)
          return
        }
        setCurrentTime(next.startTime)
      } else {
        setCurrentTime(nextTime)
      }

      imageRafRef.current = requestAnimationFrame(tick)
    }

    imageLastTsRef.current = null
    imageRafRef.current = requestAnimationFrame(tick)

    return () => {
      if (imageRafRef.current != null) cancelAnimationFrame(imageRafRef.current)
      imageRafRef.current = null
      imageLastTsRef.current = null
    }
  }, [activeClip, isPlaying, setCurrentTime, setIsPlaying])

  // Format time display
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    const ms = Math.floor((seconds % 1) * 100)
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
  }

  // Handle play/pause toggle
  const handlePlayPause = useCallback(() => {
    if (!isPlaying && !activeClip) {
      const clips = visualClipsRef.current || []
      if (clips.length === 0) return
      const next = clips.find((c) => c.startTime >= currentTime) ?? clips[0]
      setCurrentTime(next.startTime)
    }
    togglePlayPause()
  }, [togglePlayPause, isPlaying, activeClip, currentTime, setCurrentTime])

  // Handle fullscreen
  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current
    if (!container) return

    if (!document.fullscreenElement) {
      container.requestFullscreen().then(() => {
        setIsFullscreen(true)
      }).catch(console.error)
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false)
      }).catch(console.error)
    }
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if not in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      switch (e.key) {
        case ' ':
          e.preventDefault()
          handlePlayPause()
          break
        case 'f':
          toggleFullscreen()
          break
        case 'ArrowLeft':
          setCurrentTime(Math.max(0, currentTime - (e.shiftKey ? 5 : 1)))
          break
        case 'ArrowRight':
          setCurrentTime(Math.min(duration, currentTime + (e.shiftKey ? 5 : 1)))
          break
        case 'j':
          setCurrentTime(Math.max(0, currentTime - 10))
          break
        case 'l':
          setCurrentTime(Math.min(duration, currentTime + 10))
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handlePlayPause, currentTime, duration, setCurrentTime, toggleFullscreen])

  // Get visual URL and metadata from active clip (fallback to first visual clip)
  const firstVisual = (visualClips as any[])[0] ?? null
  const visualUrl = activeClip?.url || firstVisual?.url || null
  const visualFilter = useMemo(() => getVisualFilterCSS(activeClip), [activeClip])

  // Always preview inside the composition canvas, not the source media aspect ratio.
  const aspectRatio = project.resolution.width / Math.max(1, project.resolution.height)

  return (
    <div
      ref={containerRef}
      className={`relative bg-black rounded-lg overflow-hidden ${className}`}
      style={{ aspectRatio }}
      onMouseEnter={() => setShowControls(true)}
      onMouseLeave={() => setShowControls(isPlaying ? false : true)}
      onClick={handlePlayPause}
    >
      {visualUrl && activeClip?.type === 'video' ? (
        <video
          ref={videoRef}
          src={visualUrl}
          className="w-full h-full object-contain"
          style={visualFilter ? { filter: visualFilter } : undefined}
          playsInline
          preload="metadata"
        />
      ) : visualUrl && activeClip?.type === 'image' ? (
        <img
          src={visualUrl}
          className="w-full h-full object-contain select-none pointer-events-none"
          style={visualFilter ? { filter: visualFilter } : undefined}
          alt=""
          draggable={false}
        />
      ) : visualUrl ? (
        <div className="absolute inset-0 flex items-center justify-center text-gray-400">
          <div className="text-center">
            <div className="text-sm text-white/70">No clip at playhead</div>
            <div className="text-xs text-white/40 mt-1">Move clips onto the timeline to preview</div>
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-gray-400">
          <div className="text-center max-w-md px-6">
            <svg className="w-16 h-16 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <p className="text-sm text-white">No video loaded</p>
            <p className="text-xs text-white/50 mt-2">Set up your composition, then drop media into the timeline to preview your FFmpeg render.</p>
            <div className="mt-4 grid grid-cols-3 gap-2 text-[11px] text-white/70">
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                <div className="text-white/40 uppercase tracking-wide">Canvas</div>
                <div>{project.resolution.width}×{project.resolution.height}</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                <div className="text-white/40 uppercase tracking-wide">FPS</div>
                <div>{project.frameRate}</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                <div className="text-white/40 uppercase tracking-wide">Items</div>
                <div>{totalClips}</div>
              </div>
            </div>
          </div>
        </div>
      )}
      <audio ref={audioRef} className="hidden" preload="metadata" />

      {/* Captions overlay */}
      {activeCaptions.length > 0 && (
        <div className="absolute inset-0 z-10 pointer-events-none">
          {activeCaptions.map((caption: any) => {
            const preview = getCaptionPreviewState(caption, currentTime)
            return (
            <div key={caption.id} style={preview.style}>
              {preview.text}
            </div>
            )
          })}
        </div>
      )}

      {/* Play/Pause overlay */}
      {!isPlaying && visualUrl && activeClip && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-16 h-16 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
            <svg className="w-8 h-8 ml-1 text-black" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
      )}

      {/* Controls bar */}
      <div
        className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-4 py-3 transition-opacity ${
          showControls ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress bar */}
        <div className="mb-2">
          <input
            type="range"
            min="0"
            max={duration || 100}
            step="0.01"
            value={currentTime}
            onChange={(e) => setCurrentTime(parseFloat(e.target.value))}
            className="w-full h-1.5 rounded-lg appearance-none cursor-pointer bg-white/30 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
            style={{
              background: `linear-gradient(to right, #c06642 0%, #c06642 ${(currentTime / (duration || 1)) * 100}%, rgba(255,255,255,0.3) ${(currentTime / (duration || 1)) * 100}%, rgba(255,255,255,0.3) 100%)`,
            }}
          />
        </div>

        {/* Control buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Play/Pause */}
            <button
              onClick={handlePlayPause}
              className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
            >
              {isPlaying ? (
                <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            {/* Time display */}
            <span className="text-white text-xs font-mono tabular-nums">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Skip backward */}
            <button
              onClick={() => setCurrentTime(Math.max(0, currentTime - 10))}
              className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
            >
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.333 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z" />
              </svg>
            </button>

            {/* Skip forward */}
            <button
              onClick={() => setCurrentTime(Math.min(duration, currentTime + 10))}
              className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
            >
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.933 12.8a1 1 0 000-1.6L6.6 7.2A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z" />
              </svg>
            </button>

            {/* Fullscreen */}
            <button
              onClick={toggleFullscreen}
              className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
            >
              {isFullscreen ? (
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
