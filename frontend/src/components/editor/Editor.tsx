import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { useState, useCallback, useEffect, useRef } from 'react'
import { VideoPlayer, Timeline, Toolbar, MediaPanel, CaptionsPanel, EffectsPanel, ExportPanel } from './index'
import { useEditorStore, useActivePanel } from '../../stores/editorStore'

interface EditorProps {
  videoUrl?: string
  videoDuration?: number
}

interface VideoMetadata {
  duration: number
  width: number
  height: number
  fps: number
  thumbnailUrl?: string
}

// Extract full metadata from video element
const extractVideoMetadata = (url: string): Promise<VideoMetadata> => {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'

    video.onloadedmetadata = async () => {
      const duration = video.duration || 60
      const width = video.videoWidth || 1920
      const height = video.videoHeight || 1080

      // Try to detect fps (default to 30 if unavailable)
      let fps = 30
      try {
        // For more accurate fps detection, we would need to analyze the video
        // For now, we'll use a reasonable default or try to get it from the video
        if ('getVideoPlaybackQuality' in video) {
          const quality = (video as any).getVideoPlaybackQuality()
          if (quality && quality.totalVideoFrames > 0) {
            // Estimate fps based on frame delivery - simplified approach
            fps = 30 // Default, as precise detection requires more complex analysis
          }
        }
      } catch (e) {
        // FPS detection not supported, use default
      }

      // Generate thumbnail
      let thumbnailUrl: string | undefined
      try {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (ctx) {
          // Seek to first frame
          video.currentTime = 0
          await new Promise<void>((res) => {
            video.onseeked = () => {
              ctx.drawImage(video, 0, 0, width, height)
              thumbnailUrl = canvas.toDataURL('image/jpeg', 0.8)
              res()
            }
          })
        }
      } catch (e) {
        // Thumbnail generation failed
      }

      resolve({
        duration,
        width,
        height,
        fps,
        thumbnailUrl,
      })
    }

    video.onerror = () => {
      // Fallback to defaults if video fails to load
      resolve({
        duration: 60,
        width: 1920,
        height: 1080,
        fps: 30,
      })
    }

    video.src = url
  })
}

export function Editor({ videoUrl, videoDuration = 60 }: EditorProps) {
  const activePanel = useActivePanel()

  const { initializeFromVideo, setActivePanel } = useEditorStore()

  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const initialized = useRef(false)
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false)

  // Initialize with video if provided (only once)
  useEffect(() => {
    if (videoUrl && !initialized.current && !isLoadingMetadata) {
      initialized.current = true
      setIsLoadingMetadata(true)

      // Extract full metadata from video
      extractVideoMetadata(videoUrl)
        .then((metadata) => {
          // Use provided duration as fallback, otherwise use extracted
          const duration = videoDuration && videoDuration > 0 ? videoDuration : metadata.duration

          initializeFromVideo(videoUrl, {
            duration,
            width: metadata.width,
            height: metadata.height,
            fps: metadata.fps,
            thumbnailUrl: metadata.thumbnailUrl,
            name: 'Imported Video',
          })
          setIsLoadingMetadata(false)
        })
        .catch(() => {
          // Fallback to basic initialization
          initializeFromVideo(videoUrl, {
            duration: videoDuration,
            name: 'Imported Video',
          })
          setIsLoadingMetadata(false)
        })
    }
  }, [videoUrl, videoDuration, initializeFromVideo, isLoadingMetadata])

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  )

  // Handle drag start
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(event.active.id as string)
  }, [])

  // Handle drag end
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    setActiveDragId(null)

    if (!over) return

    // Handle clip drop on track
    if (over.id !== active.id) {
      const overData = over.data.current
      if (overData?.type === 'track') {
        const clipData = active.data.current
        if (clipData?.clip && clipData?.track) {
          // Calculate new start time based on drop position
          const track = overData.track
          const newStartTime = track.clips.length > 0
            ? Math.max(...track.clips.map((c: { startTime: number; duration: number }) => c.startTime + c.duration))
            : 0

          // Move clip to new track
          useEditorStore.getState().moveClip(active.id as string, track.id, newStartTime)
        }
      }
    }
  }, [])

  const renderPanel = () => {
    switch (activePanel) {
      case 'media':
        return <MediaPanel />
      case 'captions':
        return <CaptionsPanel />
      case 'effects':
        return <EffectsPanel />
      case 'export':
        return <ExportPanel />
      default:
        return <MediaPanel />
    }
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col h-screen bg-gray-900 text-white">
        {/* Top navigation */}
        <nav className="h-14 bg-gray-800 border-b border-gray-700 flex items-center px-4">
          <div className="flex items-center gap-3">
            <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <span className="font-semibold">VideoGen Editor</span>
          </div>
        </nav>

        {/* Main content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Preview + Toolbar */}
          <div className="flex-1 flex flex-col">
            {/* Toolbar */}
            <Toolbar />

            {/* Preview area */}
            <div className="flex-1 p-4 flex items-center justify-center bg-gray-900">
              <div className="w-full max-w-4xl">
                <VideoPlayer className="shadow-2xl" />
              </div>
            </div>

            {/* Timeline */}
            <div className="h-64 border-t border-gray-700">
              <Timeline />
            </div>
          </div>

          {/* Right: Panel sidebar */}
          <div className="w-80 bg-gray-800 border-l border-gray-700 flex flex-col">
            {/* Panel tabs */}
            <div className="flex border-b border-gray-700">
              {(['media', 'captions', 'effects', 'export'] as const).map((panel) => (
                <button
                  key={panel}
                  onClick={() => setActivePanel(panel)}
                  className={`flex-1 py-3 text-xs font-medium capitalize ${
                    activePanel === panel
                      ? 'text-white border-b-2 border-blue-500'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {panel}
                </button>
              ))}
            </div>

            {/* Panel content */}
            <div className="flex-1 overflow-hidden">
              {renderPanel()}
            </div>
          </div>
        </div>
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeDragId && (
          <div className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg shadow-lg">
            Moving clip...
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
