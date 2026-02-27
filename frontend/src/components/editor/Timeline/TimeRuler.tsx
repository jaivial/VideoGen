import { useMemo } from 'react'

interface TimeRulerProps {
  duration: number
  zoom: number
  scrollX: number
}

export function TimeRuler({ duration, zoom, scrollX: _scrollX }: TimeRulerProps) {
  // Calculate markers based on zoom level
  const markers = useMemo(() => {
    const result: { time: number; major: boolean; label: string }[] = []

    // Determine interval based on zoom
    let interval: number
    if (zoom < 20) {
      interval = 10 // every 10 seconds
    } else if (zoom < 50) {
      interval = 5 // every 5 seconds
    } else if (zoom < 80) {
      interval = 2 // every 2 seconds
    } else {
      interval = 1 // every second
    }

    // Add markers
    for (let time = 0; time <= duration + interval; time += interval) {
      const isMajor = time % (interval * 5) === 0 || time === 0
      result.push({
        time,
        major: isMajor,
        label: formatTime(time),
      })
    }

    return result
  }, [duration, zoom])

  return (
    <div className="relative h-full w-full">
      {markers.map((marker, index) => (
        <div
          key={index}
          className="absolute top-0 h-full flex flex-col justify-end"
          style={{ left: marker.time * zoom }}
        >
          {/* Tick mark */}
          <div
            className={`w-px ${marker.major ? 'bg-gray-400 h-full' : 'bg-gray-600 h-3'}`}
          />

          {/* Time label (only for major markers or when zoomed in) */}
          {(marker.major || zoom >= 50) && (
            <span
              className={`absolute text-[10px] text-gray-400 whitespace-nowrap ${
                marker.major ? 'top-0' : 'top-1'
              }`}
              style={{ left: 2 }}
            >
              {marker.label}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
