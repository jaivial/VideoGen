import { useMemo, useState, useCallback, useRef } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Track as TrackType, Clip as ClipType } from '../../../types/editor'
import { useZoom, useSelectedClips, useEditorStore, useActiveTool } from '../../../stores/editorStore'

interface TrackProps {
  track: TrackType
}

export function Track({ track }: TrackProps) {
  const zoom = useZoom()

  const { setNodeRef, isOver } = useDroppable({
    id: track.id,
    data: { type: 'track', track },
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
      {sortedClips.map((clip) => (
        <TrackClip key={clip.id} clip={clip} track={track} />
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
}

function TrackClip({ clip, track }: TrackClipProps) {
  const zoom = useZoom()
  const activeTool = useActiveTool()
  const selectedClips = useSelectedClips()
  const { selectClip, updateClip, splitClip } = useEditorStore()

  const [isTrimming, setIsTrimming] = useState<'left' | 'right' | null>(null)
  const trimStartRef = useRef(clip.trimStart)
  const trimEndRef = useRef(clip.trimEnd)

  const isSelected = selectedClips.includes(clip.id)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: clip.id,
    data: { type: 'clip', clip, track },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    left: clip.startTime * zoom,
    width: clip.duration * zoom,
  }

  // Handle trim start
  const handleTrimStart = useCallback((side: 'left' | 'right', e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setIsTrimming(side)
    trimStartRef.current = clip.trimStart
    trimEndRef.current = clip.trimEnd

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const trackElement = (moveEvent.target as HTMLElement).closest('.timeline-tracks')
      if (!trackElement) return

      const rect = trackElement.getBoundingClientRect()
      const trackLeft = rect.left + 150 // account for track header
      const mouseX = moveEvent.clientX - trackLeft

      // Calculate time based on mouse position relative to clip
      const clipLeft = clip.startTime * zoom
      const clipWidth = clip.duration * zoom
      const relativeX = mouseX - clipLeft

      if (side === 'left') {
        // Left trim: adjust trimStart
        const newTrimStart = Math.max(0, Math.min(relativeX / zoom, clip.trimEnd - 0.1))
        updateClip(clip.id, { trimStart: newTrimStart })
      } else {
        // Right trim: adjust trimEnd
        const maxTrimEnd = 'originalDuration' in clip ? (clip as any).originalDuration : clip.duration
        const newTrimEnd = Math.max(clip.trimStart + 0.1, Math.min(relativeX / zoom, maxTrimEnd))
        updateClip(clip.id, { trimEnd: newTrimEnd })
      }
    }

    const handleMouseUp = () => {
      setIsTrimming(null)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [clip, zoom, updateClip])

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
      className={`absolute top-1 bottom-1 rounded-md overflow-hidden cursor-pointer
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
      {...attributes}
      {...listeners}
    >
      {/* Clip content */}
      <div className="h-full p-1 flex flex-col justify-between">
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
        className={`absolute inset-y-0 left-0 w-1.5 bg-white/30 cursor-ew-resize hover:bg-white/60 transition-colors ${isTrimming === 'left' ? 'bg-white' : ''}`}
        onMouseDown={(e) => handleTrimStart('left', e)}
      />
      <div
        className={`absolute inset-y-0 right-0 w-1.5 bg-white/30 cursor-ew-resize hover:bg-white/60 transition-colors ${isTrimming === 'right' ? 'bg-white' : ''}`}
        onMouseDown={(e) => handleTrimStart('right', e)}
      />

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
            const samples = Math.floor(clip.duration * 10)
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
