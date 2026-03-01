interface PlayheadProps {
  currentTime: number
  zoom: number
  scrollX: number
  isDragging: boolean
  trackHeaderWidth?: number
  onMouseDown: (e: React.MouseEvent) => void
}

export function Playhead({
  currentTime,
  zoom,
  scrollX,
  isDragging,
  trackHeaderWidth = 144,
  onMouseDown,
}: PlayheadProps) {
  const position = currentTime * zoom - scrollX

  return (
    <div
      className={`absolute top-0 bottom-0 z-30 cursor-ew-resize group ${isDragging ? 'z-40' : ''}`}
      style={{ left: position + trackHeaderWidth }}
      onMouseDown={onMouseDown}
    >
      {/* Playhead line */}
      <div className="absolute top-0 bottom-0 w-px bg-red-500" />

      {/* Playhead handle (top) */}
      <div className="absolute -top-0 left-1/2 -translate-x-1/2 w-4 h-3 bg-red-500 rounded-b-sm flex items-center justify-center">
        <div className="w-0 h-0 border-l-2 border-r-2 border-t-3 border-transparent border-t-red-600" />
      </div>

      {/* Playhead label (shows current time) */}
      <div
        className={`absolute -top-6 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-red-500 text-white text-[10px] rounded whitespace-nowrap transition-opacity ${
          isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        {formatTime(currentTime)}
      </div>
    </div>
  )
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 100)
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
}
