import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { useState, useCallback, useEffect, useRef } from 'react'
import { VideoPlayer, Timeline, Toolbar, MediaPanel, CaptionsPanel, EffectsPanel, ExportPanel, PropertiesPanel } from './index'
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
    video.crossOrigin = 'anonymous'
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

  const { initializeFromVideo, setActivePanel, removeClip, duplicateClip, setActiveTool, selectedClipIds, undo, redo, canUndo, canRedo } = useEditorStore()

  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const initialized = useRef(false)
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false)
  const [timelineHeight, setTimelineHeight] = useState(256)
  const [isResizing, setIsResizing] = useState(false)
  const resizeRef = useRef<number | null>(null)

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      // Check for modifier keys
      const isMod = e.metaKey || e.ctrlKey

      // Delete/Backspace - remove selected clips
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        selectedClipIds.forEach(clipId => removeClip(clipId))
        return
      }

      // Ctrl/Cmd + D - duplicate selected clips
      if (isMod && e.key === 'd') {
        e.preventDefault()
        selectedClipIds.forEach(clipId => duplicateClip(clipId))
        return
      }

      // Ctrl/Cmd + Z - undo
      if (isMod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        if (canUndo()) undo()
        return
      }

      // Ctrl/Cmd + Y or Ctrl/Cmd + Shift + Z - redo
      if ((isMod && e.key === 'y') || (isMod && e.shiftKey && e.key === 'z')) {
        e.preventDefault()
        if (canRedo()) redo()
        return
      }

      // V - selection tool
      if (e.key === 'v' && !isMod) {
        e.preventDefault()
        setActiveTool('select')
        return
      }

      // B - blade tool (split clip)
      if (e.key === 'b' && !isMod) {
        e.preventDefault()
        setActiveTool('blade')
        return
      }

      // T - trim tool
      if (e.key === 't' && !isMod) {
        e.preventDefault()
        setActiveTool('trim')
        return
      }

      // Ctrl+T - text tool
      if (isMod && e.key === 't') {
        e.preventDefault()
        setActiveTool('text')
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedClipIds, removeClip, duplicateClip, undo, redo, canUndo, canRedo, setActiveTool])

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
    const { active, over, delta } = event
    setActiveDragId(null)

    if (!over) return

    // Handle clip drop on track
    if (over.id !== active.id) {
      const overData = over.data.current
      if (overData?.type === 'track') {
        const clipData = active.data.current
        if (clipData?.clip && clipData?.track) {
          const track = overData.track
          const zoom = useEditorStore.getState().zoom

          // Get the drop position from the over element
          // The over.id is the track id, so we need to calculate position from delta
          // Calculate new start time based on the original position + delta movement
          const originalClip = clipData.clip
          let newStartTime = originalClip.startTime + (delta.x / zoom)

          // Ensure non-negative start time
          newStartTime = Math.max(0, newStartTime)

          // Round to 2 decimal places for precision
          newStartTime = Math.round(newStartTime * 100) / 100

          // Move clip to new track at calculated position
          useEditorStore.getState().moveClip(active.id as string, track.id, newStartTime)
        }
      }
    }
  }, [])

  // Handle timeline resize
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    resizeRef.current = e.clientY
  }, [])

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      if (resizeRef.current === null) return
      const delta = resizeRef.current - e.clientY
      const newHeight = Math.max(150, Math.min(500, timelineHeight + delta))
      setTimelineHeight(newHeight)
      resizeRef.current = e.clientY
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      resizeRef.current = null
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, timelineHeight])

  const renderPanel = () => {
    switch (activePanel) {
      case 'media':
        return <MediaPanel />
      case 'captions':
        return <CaptionsPanel />
      case 'effects':
        return <EffectsPanel />
      case 'properties':
        return <PropertiesPanel />
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
            <div
              className="border-t border-gray-700 relative"
              style={{ height: timelineHeight }}
            >
              {/* Resize handle */}
              <div
                className={`absolute top-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-blue-500 transition-colors z-30 ${
                  isResizing ? 'bg-blue-500' : ''
                }`}
                onMouseDown={handleResizeStart}
              >
                <div className="absolute left-1/2 -translate-x-1/2 top-0 flex flex-col gap-0.5">
                  <div className="w-8 h-0.5 bg-gray-500 rounded" />
                  <div className="w-8 h-0.5 bg-gray-500 rounded" />
                </div>
              </div>
              <Timeline />
            </div>
          </div>

          {/* Right: Panel sidebar */}
          <div className="w-80 bg-gray-800 border-l border-gray-700 flex flex-col">
            {/* Panel tabs */}
            <div className="flex border-b border-gray-700">
              {(['media', 'captions', 'effects', 'properties', 'export'] as const).map((panel) => (
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
