import { useMemo } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Track as TrackType, Clip as ClipType } from '../../../types/editor'
import { useZoom, useSelectedClips, useEditorStore } from '../../../stores/editorStore'

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
  const selectedClips = useSelectedClips()
  const { selectClip } = useEditorStore()

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
      <div className="absolute inset-y-0 left-0 w-1.5 bg-white/30 cursor-ew-resize hover:bg-white/60 transition-colors" />
      <div className="absolute inset-y-0 right-0 w-1.5 bg-white/30 cursor-ew-resize hover:bg-white/60 transition-colors" />

      {/* Video thumbnail placeholder */}
      {clip.type === 'video' && thumbnailUrl && (
        <div
          className="absolute inset-0 opacity-30 bg-cover bg-center"
          style={{ backgroundImage: `url(${thumbnailUrl})` }}
        />
      )}

      {/* Audio waveform placeholder */}
      {clip.type === 'audio' && (
        <div className="absolute inset-0 flex items-center justify-center gap-px overflow-hidden opacity-50">
          {Array.from({ length: Math.floor(clip.duration * 10) }).map((_, i) => (
            <div
              key={i}
              className="w-0.5 bg-white rounded-full"
              style={{ height: `${Math.random() * 60 + 20}%` }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
