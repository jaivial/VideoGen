import { useRef, useEffect, useState, useCallback } from 'react'
import { useEditorStore, useTracks, useCurrentTime, useDuration, useZoom } from '../../../stores/editorStore'
import { Track } from './Track'
import { TimeRuler } from './TimeRuler'
import { Playhead } from './Playhead'

export function Timeline() {
  const timelineRef = useRef<HTMLDivElement>(null)
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false)

  const tracks = useTracks()
  const currentTime = useCurrentTime()
  const duration = useDuration()
  const zoom = useZoom()

  const { setCurrentTime, setZoom, setScrollX, scrollX } = useEditorStore()

  // Calculate timeline width
  const timelineWidth = Math.max(duration * zoom + 200, 800)

  // Handle zoom with mouse wheel
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -5 : 5
      setZoom(zoom + delta)
    } else {
      // Horizontal scroll
      const newScrollX = Math.max(0, scrollX + e.deltaX + e.deltaY)
      setScrollX(newScrollX)
    }
  }, [zoom, scrollX, setZoom, setScrollX])

  // Handle playhead drag
  const handlePlayheadMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDraggingPlayhead(true)
  }, [])

  // Handle timeline click to seek
  const handleTimelineClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (isDraggingPlayhead) return

    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left + scrollX - 150 // 150px for track headers
    const time = x / zoom
    setCurrentTime(Math.max(0, Math.min(time, duration)))
  }, [zoom, scrollX, duration, setCurrentTime, isDraggingPlayhead])

  // Global mouse events for playhead dragging
  useEffect(() => {
    if (!isDraggingPlayhead) return

    const handleMouseMove = (e: MouseEvent) => {
      const timeline = timelineRef.current
      if (!timeline) return

      const rect = timeline.getBoundingClientRect()
      const x = e.clientX - rect.left + scrollX - 150
      const time = x / zoom
      setCurrentTime(Math.max(0, Math.min(time, duration)))
    }

    const handleMouseUp = () => {
      setIsDraggingPlayhead(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDraggingPlayhead, zoom, scrollX, duration, setCurrentTime])

  // Format time for display
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-lg overflow-hidden">
      {/* Timeline toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-gray-400 text-xs">Zoom:</span>
          <input
            type="range"
            min="10"
            max="200"
            value={zoom}
            onChange={(e) => setZoom(parseInt(e.target.value))}
            className="w-24 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
          />
          <span className="text-gray-400 text-xs w-12">{Math.round(zoom)}px/s</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentTime(0)}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded"
          >
            Go to start
          </button>
          <button
            onClick={() => setCurrentTime(duration)}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded"
          >
            Go to end
          </button>
        </div>
      </div>

      {/* Timeline content */}
      <div
        ref={timelineRef}
        className="flex-1 overflow-auto relative"
        onWheel={handleWheel}
      >
        <div
          className="relative min-h-full"
          style={{ width: timelineWidth, minWidth: '100%' }}
          onClick={handleTimelineClick}
        >
          {/* Track headers */}
          <div className="sticky left-0 z-20 bg-gray-800 border-r border-gray-700">
            {tracks.map((track) => (
              <div
                key={track.id}
                className="flex items-center px-2 border-b border-gray-700"
                style={{ height: track.height }}
              >
                <span className="text-xs text-gray-400 truncate flex-1">{track.name}</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => useEditorStore.getState().updateTrack(track.id, { muted: !track.muted })}
                    className={`p-1 rounded ${track.muted ? 'text-red-400' : 'text-gray-400'}`}
                    title={track.muted ? 'Unmute' : 'Mute'}
                  >
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                      {track.muted ? (
                        <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                      ) : (
                        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                      )}
                    </svg>
                  </button>
                  <button
                    onClick={() => useEditorStore.getState().updateTrack(track.id, { locked: !track.locked })}
                    className={`p-1 rounded ${track.locked ? 'text-yellow-400' : 'text-gray-400'}`}
                    title={track.locked ? 'Unlock' : 'Lock'}
                  >
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                      {track.locked ? (
                        <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" />
                      ) : (
                        <path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z" />
                      )}
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Time ruler */}
          <div className="sticky top-0 z-10 h-6 bg-gray-800 border-b border-gray-700 ml-36">
            <TimeRuler duration={duration} zoom={zoom} scrollX={scrollX} />
          </div>

          {/* Tracks area */}
          <div className="ml-36" style={{ marginTop: -24 }}>
            {tracks.map((track) => (
              <Track key={track.id} track={track} />
            ))}
          </div>

          {/* Playhead */}
          <Playhead
            currentTime={currentTime}
            zoom={zoom}
            scrollX={scrollX}
            isDragging={isDraggingPlayhead}
            onMouseDown={handlePlayheadMouseDown}
          />
        </div>
      </div>

      {/* Current time indicator */}
      <div className="px-4 py-1 bg-gray-800 border-t border-gray-700 text-xs text-gray-400">
        Current time: {formatTime(currentTime)} | Duration: {formatTime(duration)}
      </div>
    </div>
  )
}
