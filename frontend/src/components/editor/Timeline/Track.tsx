import { useMemo, useState, useCallback, useRef } from 'react'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import type { Track as TrackType, Clip as ClipType } from '../../../types/editor'
import { useZoom, useSelectedClips, useEditorStore, useActiveTool } from '../../../stores/editorStore'

interface TrackProps {
  track: TrackType
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function getTransitionEffect(clip: ClipType) {
  const effects = Array.isArray((clip as any).effects) ? (clip as any).effects : []
  return effects.find((effect: any) => effect?.type === 'transition') || null
}

function getTransitionDuration(clip: ClipType) {
  const effect = getTransitionEffect(clip)
  const duration = Number(effect?.params?.duration)
  return Number.isFinite(duration) ? Math.max(0, duration) : 0
}

export function Track({ track }: TrackProps) {
  const zoom = useZoom()

  const { setNodeRef, isOver } = useDroppable({
    id: track.id,
    data: { type: 'track', track },
    disabled: track.locked,
  })

  // Sort clips by start time
  const sortedClips = useMemo(() => {
    return [...track.clips].sort((a, b) => a.startTime - b.startTime)
  }, [track.clips])

  // Track colors
  const trackColors = {
    video: { bg: 'bg-blue-900/50' },
    audio: { bg: 'bg-green-900/50' },
    caption: { bg: 'bg-purple-900/50' },
  }

  const colors = trackColors[track.type]

  return (
    <div
      ref={setNodeRef}
      className={`relative border-b ${colors.bg} ${isOver ? 'ring-2 ring-blue-500' : ''}`}
      style={{ height: track.height, minHeight: 40 }}
    >
      {/* Track background with grid lines */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(to right, rgba(255,255,255,0.03) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(255,255,255,0.03) 1px, transparent 1px)
          `,
          backgroundSize: `${zoom}px 100%`,
        }}
      />

      {/* Clips */}
      {sortedClips.map((clip, index) => (
        <TrackClip key={clip.id} clip={clip} track={track} nextClip={sortedClips[index + 1] ?? null} />
      ))}

      {/* Empty track indicator */}
      {sortedClips.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-gray-600 text-xs">Drop media here</span>
        </div>
      )}
    </div>
  )
}

// Individual Clip component
interface TrackClipProps {
  clip: ClipType
  track: TrackType
  nextClip: ClipType | null
}

function TrackClip({ clip, track, nextClip }: TrackClipProps) {
  const zoom = useZoom()
  const activeTool = useActiveTool()
  const selectedClips = useSelectedClips()
  const { selectClip, updateClip, splitClip, commitHistory } = useEditorStore()
  const trimHandleWidth = 10

  const [isTrimming, setIsTrimming] = useState<'left' | 'right' | null>(null)
  const [isAdjustingTransition, setIsAdjustingTransition] = useState(false)
  const trimSessionRef = useRef<{
    mouseX: number
    startTime: number
    duration: number
    trimStart: number
    trimEnd: number
    speed: number
    originalDuration?: number
  } | null>(null)
  const transitionSessionRef = useRef<{
    mouseX: number
    duration: number
    maxDuration: number
  } | null>(null)

  const isSelected = selectedClips.includes(clip.id)
  const canTransitionTypes =
    (clip.type === 'video' || clip.type === 'image') &&
    !!nextClip &&
    (nextClip.type === 'video' || nextClip.type === 'image')
  const transitionGap = canTransitionTypes
    ? Math.abs(nextClip!.startTime - (clip.startTime + clip.duration))
    : Number.POSITIVE_INFINITY
  const supportsTransition = canTransitionTypes && transitionGap <= 0.2
  const maxTransitionDuration = supportsTransition
    ? Math.max(0, Math.min(2, clip.duration - 0.05, nextClip!.duration - 0.05))
    : 0
  const transitionDuration = supportsTransition
    ? clamp(getTransitionDuration(clip), 0, maxTransitionDuration)
    : 0

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: clip.id,
    data: { type: 'clip', clip, track },
    disabled: track.locked || isTrimming !== null || isAdjustingTransition,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : 'transform 120ms ease',
    left: clip.startTime * zoom,
    width: clip.duration * zoom,
  }

  // Handle trim start
  const handleTrimStart = useCallback((side: 'left' | 'right', e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (track.locked) return

    setIsTrimming(side)
    trimSessionRef.current = {
      mouseX: e.clientX,
      startTime: clip.startTime,
      duration: clip.duration,
      trimStart: clip.trimStart,
      trimEnd: clip.trimEnd,
      speed: Number((clip as any).speed ?? 1),
      originalDuration: (clip as any).originalDuration,
    }

    const minTimeline = 0.05
    const minSource = 0.05

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const session = trimSessionRef.current
      if (!session) return

      const deltaTime = (moveEvent.clientX - session.mouseX) / zoom
      const speed = clamp(session.speed || 1, 0.25, 4)

      if (side === 'left') {
        const minDelta = Math.max(-session.startTime, -(session.trimStart / speed))
        const maxDelta = Math.min(session.duration - minTimeline, (session.trimEnd - minSource - session.trimStart) / speed)
        const clampedDelta = clamp(deltaTime, minDelta, maxDelta)

        const nextStartTime = session.startTime + clampedDelta
        const nextDuration = session.duration - clampedDelta
        const nextTrimStart = session.trimStart + clampedDelta*speed

        updateClip(
          clip.id,
          { startTime: nextStartTime, duration: nextDuration, trimStart: nextTrimStart },
          { commit: false }
        )
        return
      }

      // right
      const maxSource =
        typeof session.originalDuration === 'number' && session.originalDuration > 0
          ? session.originalDuration
          : Number.POSITIVE_INFINITY

      const minDeltaByTimeline = -(session.duration - minTimeline)
      const minDeltaBySource = (session.trimStart + minSource - session.trimEnd) / speed
      const maxDelta = (maxSource - session.trimEnd) / speed
      const clampedDelta = clamp(deltaTime, Math.max(minDeltaByTimeline, minDeltaBySource), maxDelta)

      const nextDuration = session.duration + clampedDelta
      const nextTrimEnd = clamp(session.trimEnd + clampedDelta*speed, session.trimStart + minSource, maxSource)

      updateClip(
        clip.id,
        { duration: nextDuration, trimEnd: nextTrimEnd },
        { commit: false }
      )
    }

    const handleMouseUp = () => {
      setIsTrimming(null)
      trimSessionRef.current = null
      commitHistory()
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [clip, track.locked, zoom, updateClip, commitHistory])

  const applyTransitionDuration = useCallback((duration: number, commit: boolean) => {
    const effects = Array.isArray((clip as any).effects) ? [...(clip as any).effects] : []
    const transitionIdx = effects.findIndex((effect: any) => effect?.type === 'transition')

    if (duration <= 0.01) {
      if (transitionIdx !== -1) effects.splice(transitionIdx, 1)
      updateClip(clip.id, { effects } as any, { commit })
      return
    }

    const existing = transitionIdx !== -1 ? effects[transitionIdx] : null
    const transitionEffect = {
      id: existing?.id || `transition-${clip.id}`,
      type: 'transition',
      name: 'Transition',
      enabled: true,
      params: {
        style: (existing?.params?.style as string) || 'fade',
        duration,
      },
    }

    if (transitionIdx !== -1) {
      effects[transitionIdx] = transitionEffect
    } else {
      effects.push(transitionEffect)
    }

    updateClip(clip.id, { effects } as any, { commit })
  }, [clip, updateClip])

  const handleTransitionDragStart = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (track.locked || !supportsTransition || maxTransitionDuration <= 0) return

    setIsAdjustingTransition(true)
    transitionSessionRef.current = {
      mouseX: e.clientX,
      duration: transitionDuration,
      maxDuration: maxTransitionDuration,
    }

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const session = transitionSessionRef.current
      if (!session) return

      const delta = (moveEvent.clientX - session.mouseX) / zoom
      const nextDuration = clamp(session.duration + delta, 0, session.maxDuration)
      applyTransitionDuration(nextDuration, false)
    }

    const handleMouseUp = () => {
      setIsAdjustingTransition(false)
      transitionSessionRef.current = null
      commitHistory()
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [track.locked, supportsTransition, maxTransitionDuration, transitionDuration, zoom, applyTransitionDuration, commitHistory])

  // Clip colors based on type
  const clipColors: Record<string, string> = {
    video: 'bg-blue-500',
    image: 'bg-amber-500',
    audio: 'bg-green-500',
    caption: 'bg-purple-500',
  }

  // Handle double-click to edit
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    console.log('Edit clip:', clip.id)
  }

  // Handle context menu
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    console.log('Context menu for clip:', clip.id)
  }

  // Get thumbnail if available
  const thumbnailUrl = 'thumbnailUrl' in clip ? clip.thumbnailUrl : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`absolute top-1 bottom-1 rounded-md overflow-hidden cursor-default
        ${clipColors[clip.type] || 'bg-gray-500'}
        ${isSelected ? 'ring-2 ring-white z-10' : ''}
        ${isDragging ? 'opacity-50' : ''}
        hover:brightness-110 transition-all
      `}
      onClick={(e) => {
        e.stopPropagation()

        // Handle blade tool - split clip at click position
        if (activeTool === 'blade') {
          const rect = e.currentTarget.getBoundingClientRect()
          const clickX = e.clientX - rect.left
          const clipWidth = clip.duration * zoom
          const relativeX = clickX
          const splitRatio = relativeX / clipWidth

          // Only split if click is within the clip bounds (not at edges)
          if (splitRatio > 0.05 && splitRatio < 0.95) {
            const splitTime = clip.startTime + (clip.duration * splitRatio)
            splitClip(clip.id, splitTime)
          }
          return
        }

        // Normal selection
        selectClip(clip.id, e.shiftKey)
      }}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
    >
      {/* Drag zone (center only) */}
      <div
        className={`absolute inset-y-0 z-10 ${isDragging ? 'cursor-grabbing' : 'cursor-grab active:cursor-grabbing'}`}
        style={{ left: trimHandleWidth, right: trimHandleWidth }}
        {...attributes}
        {...listeners}
      />

      {/* Clip content */}
      <div className="h-full p-1 flex flex-col justify-between pointer-events-none">
        {/* Clip name */}
        <span className="text-xs text-white truncate drop-shadow-sm">
          {clip.name}
        </span>

        {/* Duration indicator */}
        <span className="text-[10px] text-white/70 truncate">
          {clip.duration.toFixed(1)}s
        </span>
      </div>

      {/* Trim handles (left/right edges) */}
      <div
        className={`absolute inset-y-0 left-0 z-20 w-2.5 bg-white/40 cursor-ew-resize hover:bg-white/70 transition-colors touch-none ${isTrimming === 'left' ? 'bg-white' : ''}`}
        onMouseDown={(e) => handleTrimStart('left', e)}
      />
      <div
        className={`absolute inset-y-0 right-0 z-20 w-2.5 bg-white/40 cursor-ew-resize hover:bg-white/70 transition-colors touch-none ${isTrimming === 'right' ? 'bg-white' : ''}`}
        onMouseDown={(e) => handleTrimStart('right', e)}
      />

      {/* Transition handle (to next visual clip) */}
      {supportsTransition && maxTransitionDuration > 0 && (
        <button
          onMouseDown={handleTransitionDragStart}
          onClick={(e) => e.stopPropagation()}
          className={`absolute -bottom-1 right-2 z-30 px-1.5 py-0.5 rounded bg-black/70 border text-[10px] leading-none ${
            transitionDuration > 0 ? 'border-cyan-400/70 text-cyan-200' : 'border-white/30 text-white/70'
          }`}
          title="Drag to set transition duration"
        >
          {transitionDuration > 0 ? `${transitionDuration.toFixed(2)}s` : 'T'}
        </button>
      )}

      {/* Video thumbnail placeholder */}
      {clip.type === 'video' && thumbnailUrl && (
        <div
          className="absolute inset-0 opacity-30 bg-cover bg-center"
          style={{ backgroundImage: `url(${thumbnailUrl})` }}
        />
      )}

      {/* Audio waveform */}
      {clip.type === 'audio' && (
        <div className="absolute inset-0 flex items-center justify-center gap-px overflow-hidden opacity-70">
          {(() => {
            const waveform = 'waveformData' in clip ? (clip as any).waveformData : null
            const pxWidth = Math.max(1, clip.duration * zoom)
            const samples = Math.min(240, Math.max(24, Math.floor(pxWidth / 6)))
            if (waveform && waveform.length > 0) {
              // Resample waveform to match clip duration
              const resampled: number[] = []
              for (let i = 0; i < samples; i++) {
                const idx = Math.floor((i / samples) * waveform.length)
                resampled.push(waveform[idx])
              }
              return resampled.map((v, i) => (
                <div
                  key={i}
                  className="w-0.5 bg-white/80 rounded-full"
                  style={{ height: `${Math.max(5, v * 80)}%` }}
                />
              ))
            }
            // Fallback to simple visualization
            return Array.from({ length: samples }).map((_, i) => (
              <div
                key={i}
                className="w-0.5 bg-white/60 rounded-full"
                style={{ height: `${20 + Math.sin(i * 0.3) * 15}%` }}
              />
            ))
          })()}
        </div>
      )}
    </div>
  )
}
