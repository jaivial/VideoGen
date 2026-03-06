import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { PanelLeftClose, PanelRightClose } from 'lucide-react'
import { VideoPlayer, Timeline, Toolbar, MediaPanel, CaptionsPanel, EffectsPanel, ExportPanel, PropertiesPanel } from './index'
import { useEditorStore, useActivePanel } from '../../stores/editorStore'

export interface EditorInitialAssets {
  downloadUrl?: string
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
}

interface EditorProps {
  videoId?: string
  videoUrl?: string
  videoDuration?: number
  initialAssets?: EditorInitialAssets
}

interface VideoMetadata {
  duration: number
  width: number
  height: number
  fps: number
  thumbnailUrl?: string
}

interface PreviewWorkspaceProps {
  layoutVersion: string
  workspaceClassName: string
  stageClassName: string
  testId?: string
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

const fitPreviewStage = (containerWidth: number, containerHeight: number, aspectRatio: number) => {
  const safeWidth = Math.max(0, containerWidth)
  const safeHeight = Math.max(0, containerHeight)
  const inset = Math.min(56, Math.max(24, Math.min(safeWidth, safeHeight) * 0.08))
  const availableWidth = Math.max(160, safeWidth - inset * 2)
  const availableHeight = Math.max(160, safeHeight - inset * 2)

  let width = availableWidth
  let height = width / aspectRatio

  if (height > availableHeight) {
    height = availableHeight
    width = height * aspectRatio
  }

  return {
    width: Math.round(width),
    height: Math.round(height),
  }
}

function PreviewWorkspace({ layoutVersion, workspaceClassName, stageClassName, testId }: PreviewWorkspaceProps) {
  const project = useEditorStore((state) => state.project)
  const workspaceRef = useRef<HTMLDivElement | null>(null)
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const updateStageSize = () => {
      const workspace = workspaceRef.current
      if (!workspace) return

      const bounds = workspace.getBoundingClientRect()
      const aspectRatio = project.resolution.width / Math.max(1, project.resolution.height)
      setStageSize(fitPreviewStage(bounds.width, bounds.height, aspectRatio))
    }

    updateStageSize()
    const rafId = requestAnimationFrame(updateStageSize)
    window.addEventListener('resize', updateStageSize)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', updateStageSize)
    }
  }, [layoutVersion, project.resolution.height, project.resolution.width])

  return (
    <div
      ref={workspaceRef}
      data-testid={testId}
      className={workspaceClassName}
    >
      <div
        className="relative shrink-0 transition-[width,height] duration-200 ease-out"
        style={stageSize.width > 0 && stageSize.height > 0 ? { width: stageSize.width, height: stageSize.height } : undefined}
      >
        <VideoPlayer className={stageClassName} />
      </div>
    </div>
  )
}

export function Editor({ videoId, videoUrl, videoDuration = 60, initialAssets }: EditorProps) {
  const activePanel = useActivePanel()

  const { initializeFromVideo, setActivePanel, removeClip, duplicateClip, setActiveTool, selectedClipIds, undo, redo, canUndo, canRedo, project, tracks, setProjectName } = useEditorStore()

  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const initialized = useRef(false)
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false)
  const [timelineHeight, setTimelineHeight] = useState(256)
  const [isResizing, setIsResizing] = useState(false)
  const resizeRef = useRef<number | null>(null)
  const [mobilePanel, setMobilePanel] = useState<null | 'tools' | 'inspector'>(null)
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true)
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true)
  const clipCount = useMemo(() => tracks.reduce((count, track) => count + track.clips.length, 0), [tracks])

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

  const panelTabs = useMemo(() => {
    return [
      {
        id: 'media' as const,
        label: 'Media',
        icon: (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        ),
      },
      {
        id: 'captions' as const,
        label: 'Captions',
        icon: (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h6m-6 4h10M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        ),
      },
      {
        id: 'effects' as const,
        label: 'Effects',
        icon: (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0a1.724 1.724 0 002.573 1.01c.815-.493 1.82.512 1.327 1.327a1.724 1.724 0 001.01 2.573c.921.3.921 1.603 0 1.902a1.724 1.724 0 00-1.01 2.573c.493.815-.512 1.82-1.327 1.327a1.724 1.724 0 00-2.573 1.01c-.3.921-1.603.921-1.902 0a1.724 1.724 0 00-2.573-1.01c-.815.493-1.82-.512-1.327-1.327a1.724 1.724 0 00-1.01-2.573c-.921-.3-.921-1.603 0-1.902a1.724 1.724 0 001.01-2.573c-.493-.815.512-1.82 1.327-1.327.99.6 2.256.061 2.573-1.01z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      },
      {
        id: 'export' as const,
        label: 'Export',
        icon: (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        ),
      },
    ]
  }, [])

  // Initialize with video if provided (only once)
  const resolvedVideoUrl = initialAssets?.downloadUrl || videoUrl

  useEffect(() => {
    if (resolvedVideoUrl && !initialized.current && !isLoadingMetadata) {
      initialized.current = true
      setIsLoadingMetadata(true)

      // Extract full metadata from video
      extractVideoMetadata(resolvedVideoUrl)
        .then((metadata) => {
          // Use provided duration as fallback, otherwise use extracted
          const duration = videoDuration && videoDuration > 0 ? videoDuration : metadata.duration

          initializeFromVideo(resolvedVideoUrl, {
            duration,
            width: metadata.width,
            height: metadata.height,
            fps: metadata.fps,
            thumbnailUrl: metadata.thumbnailUrl,
            name: 'Imported Video',
            separateTracks: Boolean(initialAssets),
            audioUrl: initialAssets?.audioUrl,
            imageUrls: initialAssets?.imageUrls || [],
            imageSegments: initialAssets?.imageSegments || [],
            audioSegments: initialAssets?.audioSegments || [],
            captionSegments: initialAssets?.captionSegments || [],
            translatedLines: initialAssets?.translatedLines || [],
            transcriptionChunks: initialAssets?.transcriptionChunks || [],
            transcribedText: initialAssets?.transcribedText || '',
          })
          setIsLoadingMetadata(false)
        })
        .catch(() => {
          // Fallback to basic initialization
          initializeFromVideo(resolvedVideoUrl, {
            duration: videoDuration,
            name: 'Imported Video',
            separateTracks: Boolean(initialAssets),
            audioUrl: initialAssets?.audioUrl,
            imageUrls: initialAssets?.imageUrls || [],
            imageSegments: initialAssets?.imageSegments || [],
            audioSegments: initialAssets?.audioSegments || [],
            captionSegments: initialAssets?.captionSegments || [],
            translatedLines: initialAssets?.translatedLines || [],
            transcriptionChunks: initialAssets?.transcriptionChunks || [],
            transcribedText: initialAssets?.transcribedText || '',
          })
          setIsLoadingMetadata(false)
        })
    }
  }, [resolvedVideoUrl, videoDuration, initializeFromVideo, isLoadingMetadata, initialAssets])

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
          const state = useEditorStore.getState()
          const zoom = state.zoom
          const destinationTrackId = String(overData.track?.id ?? over.id)
          const destinationTrack =
            state.tracks.find((t) => t.id === destinationTrackId) ?? overData.track

          if (!destinationTrack || destinationTrack.locked) return

          // Get the drop position from the over element
          // The over.id is the track id, so we need to calculate position from delta
          // Calculate new start time based on the original position + delta movement
          const originalClip = clipData.clip
          const clipKind = originalClip.type
          if (
            (clipKind === 'video' || clipKind === 'image') && destinationTrack.type !== 'video' ||
            clipKind === 'audio' && destinationTrack.type !== 'audio' ||
            clipKind === 'caption' && destinationTrack.type !== 'caption'
          ) {
            return
          }
          let newStartTime = originalClip.startTime + (delta.x / zoom)

          // Ensure non-negative start time
          newStartTime = Math.max(0, newStartTime)

          // Snap unless Shift is held (CapCut-style behavior)
          const shiftKey = Boolean((event as any).activatorEvent?.shiftKey)
          if (!shiftKey) {
            const snapThreshold = 0.15 // seconds
            const candidates: number[] = [0, state.currentTime]

            for (const c of destinationTrack.clips) {
              if (c.id === originalClip.id) continue
              candidates.push(c.startTime, c.startTime + c.duration)
            }

            let best = newStartTime
            let bestDist = Number.POSITIVE_INFINITY
            for (const candidate of candidates) {
              const dist = Math.abs(candidate - newStartTime)
              if (dist < bestDist) {
                bestDist = dist
                best = candidate
              }
            }

            if (bestDist <= snapThreshold) newStartTime = best
          }

          // Round to 2 decimal places for precision
          newStartTime = Math.round(newStartTime * 100) / 100

          // Move clip to new track at calculated position
          state.moveClip(active.id as string, destinationTrack.id, newStartTime)
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
        return <ExportPanel videoId={videoId} />
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
      <div className="h-screen w-full bg-[#0b0c10] text-white overflow-hidden">
        {/* Top bar */}
        <header className="h-14 border-b border-white/10 bg-[#0f1117] flex items-center px-3 lg:px-4 gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
              <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="min-w-0">
              <input
                value={project.name}
                onChange={(e) => setProjectName(e.target.value)}
                className="w-full bg-transparent text-sm font-semibold outline-none truncate"
              />
              <div className="text-[11px] text-white/50 truncate">FFmpeg composition studio</div>
            </div>
          </div>

          <div className="flex-1" />

          {/* Mobile toggles */}
          <div className="flex items-center gap-2 lg:hidden">
            <button
              onClick={() => setMobilePanel('tools')}
              className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs"
            >
              Tools
            </button>
            <button
              onClick={() => setMobilePanel('inspector')}
              className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs"
            >
              Inspector
            </button>
          </div>

          {/* Desktop actions */}
          <div className="hidden lg:flex items-center gap-2">
            <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
              <button
                onClick={undo}
                disabled={!canUndo()}
                className="px-2 py-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
                title="Undo (Ctrl+Z)"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
              </button>
              <button
                onClick={redo}
                disabled={!canRedo()}
                className="px-2 py-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
                title="Redo (Ctrl+Shift+Z)"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
                </svg>
              </button>
            </div>

            <button
              onClick={() => setActivePanel('export')}
              className="px-3 py-2 rounded-xl bg-emerald-500/90 hover:bg-emerald-500 text-black text-xs font-semibold"
            >
              Export
            </button>
          </div>
        </header>

        {/* Shell */}
        <div className="h-[calc(100vh-56px)] w-full min-h-0 bg-[#0b0c10]">
          <div
            className="hidden lg:grid h-full min-h-0"
            style={{
              gridTemplateColumns: `64px ${leftSidebarOpen ? '320px' : '0px'} minmax(0,1fr) ${rightSidebarOpen ? '320px' : '0px'}`,
              gridTemplateRows: `minmax(0,1fr) ${timelineHeight}px`,
            }}
          >
            <aside className="col-start-1 row-span-2 w-16 border-r border-white/10 bg-[#0b0c10] flex flex-col items-center py-3 gap-2 min-h-0">
              {panelTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActivePanel(tab.id)}
                  className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-1 border transition-colors ${
                    activePanel === tab.id
                      ? 'bg-white/10 border-white/20 text-white'
                      : 'bg-white/0 border-white/10 text-white/60 hover:text-white hover:bg-white/5'
                  }`}
                  title={tab.label}
                >
                  {tab.icon}
                  <span className="text-[10px] leading-none">{tab.label}</span>
                </button>
              ))}
            </aside>

            {leftSidebarOpen && (
              <aside className="col-start-2 row-start-1 border-r border-white/10 bg-[#0f1117] min-w-0 min-h-0 flex flex-col">
                <div className="h-10 px-3 border-b border-white/10 flex items-center justify-between">
                  <span className="text-xs font-semibold text-white/80">Media Library</span>
                  <button
                    onClick={() => setLeftSidebarOpen(false)}
                    className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10"
                    title="Hide media library"
                  >
                    <PanelLeftClose className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  {renderPanel()}
                </div>
              </aside>
            )}

            <main className="col-start-3 row-start-1 min-w-0 min-h-0 flex flex-col bg-[#0b0c10] relative">
              <Toolbar
                testId="editor-toolbar"
                leftSidebarOpen={leftSidebarOpen}
                rightSidebarOpen={rightSidebarOpen}
                onOpenLeftSidebar={() => setLeftSidebarOpen(true)}
                onOpenRightSidebar={() => setRightSidebarOpen(true)}
              />

              <div className="px-3 lg:px-4 pt-3">
                <div className="rounded-2xl border border-white/10 bg-[#11151e] px-4 py-3 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="px-2.5 py-1 rounded-full bg-cyan-500/10 text-cyan-200 border border-cyan-500/20">
                      {project.resolution.label}
                    </span>
                    <span className="px-2.5 py-1 rounded-full bg-white/5 text-white/70 border border-white/10">
                      {project.resolution.width}×{project.resolution.height}
                    </span>
                    <span className="px-2.5 py-1 rounded-full bg-white/5 text-white/70 border border-white/10">
                      {project.frameRate} fps
                    </span>
                    <span className="px-2.5 py-1 rounded-full bg-white/5 text-white/70 border border-white/10">
                      {project.duration.toFixed(1)}s timeline
                    </span>
                    <span className="px-2.5 py-1 rounded-full bg-white/5 text-white/70 border border-white/10">
                      {clipCount} items
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {[
                      { id: 'media', label: 'Media' },
                      { id: 'captions', label: 'Captions' },
                      { id: 'effects', label: 'Effects' },
                      { id: 'export', label: 'Render' },
                    ].map((action) => (
                      <button
                        key={action.id}
                        type="button"
                        onClick={() => setActivePanel(action.id as any)}
                        className={`px-3 py-2 rounded-xl text-xs border transition-colors ${
                          activePanel === action.id
                            ? 'bg-white/10 border-white/20 text-white'
                            : 'bg-white/0 border-white/10 text-white/60 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex-1 min-h-0 p-3 lg:p-4">
                <PreviewWorkspace
                  testId="preview-workspace"
                  layoutVersion={`${timelineHeight}:${leftSidebarOpen}:${rightSidebarOpen}:${project.resolution.width}x${project.resolution.height}`}
                  workspaceClassName="h-full min-h-[320px] rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(36,42,62,0.95),_rgba(12,14,20,0.98))] p-4 lg:p-6 flex items-center justify-center overflow-hidden"
                  stageClassName="w-full h-full shadow-[0_30px_80px_rgba(0,0,0,0.55)] border border-white/10"
                />
              </div>
            </main>

            {rightSidebarOpen && (
              <aside className="col-start-4 row-start-1 border-l border-white/10 bg-[#0f1117] min-w-0 min-h-0 flex flex-col">
                <div className="h-10 px-3 border-b border-white/10 flex items-center justify-between">
                  <span className="text-xs font-semibold text-white/80">Properties</span>
                  <button
                    onClick={() => setRightSidebarOpen(false)}
                    className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10"
                    title="Hide properties"
                  >
                    <PanelRightClose className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  <PropertiesPanel />
                </div>
              </aside>
            )}

            <div className="col-start-2 col-end-5 row-start-2 border-t border-white/10 relative bg-[#0f1117] min-w-0 min-h-0">
              <div
                className={`absolute top-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-sky-500/70 transition-colors z-30 ${
                  isResizing ? 'bg-sky-500/70' : ''
                }`}
                onMouseDown={handleResizeStart}
              >
                <div className="absolute left-1/2 -translate-x-1/2 top-0 flex flex-col gap-0.5">
                  <div className="w-8 h-0.5 bg-white/30 rounded" />
                  <div className="w-8 h-0.5 bg-white/30 rounded" />
                </div>
              </div>
              <Timeline />
            </div>
          </div>

          {/* Mobile shell */}
          <div className="lg:hidden h-full min-h-0 flex flex-col">
            <main className="min-w-0 min-h-0 flex-1 flex flex-col bg-[#0b0c10]">
              <Toolbar />

              <div className="px-3 pt-3">
                <div className="rounded-2xl border border-white/10 bg-[#11151e] px-4 py-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-white/70">
                    <span className="px-2.5 py-1 rounded-full bg-cyan-500/10 text-cyan-200 border border-cyan-500/20">{project.resolution.label}</span>
                    <span>{project.resolution.width}×{project.resolution.height}</span>
                    <span>•</span>
                    <span>{project.frameRate} fps</span>
                    <span>•</span>
                    <span>{clipCount} items</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {[
                      { id: 'media', label: 'Media' },
                      { id: 'captions', label: 'Captions' },
                      { id: 'effects', label: 'Effects' },
                      { id: 'export', label: 'Render' },
                    ].map((action) => (
                      <button
                        key={action.id}
                        type="button"
                        onClick={() => setActivePanel(action.id as any)}
                        className={`px-3 py-2 rounded-xl text-xs border ${
                          activePanel === action.id
                            ? 'bg-white/10 border-white/20 text-white'
                            : 'bg-white/0 border-white/10 text-white/60'
                        }`}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex-1 min-h-0 p-3">
                <PreviewWorkspace
                  layoutVersion={`${timelineHeight}:mobile:${project.resolution.width}x${project.resolution.height}`}
                  workspaceClassName="h-full min-h-[260px] rounded-[24px] border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(36,42,62,0.95),_rgba(12,14,20,0.98))] p-3 flex items-center justify-center overflow-hidden"
                  stageClassName="w-full h-full shadow-[0_30px_80px_rgba(0,0,0,0.55)] border border-white/10"
                />
              </div>

              <div className="border-t border-white/10 relative bg-[#0f1117]" style={{ height: timelineHeight }}>
                <div
                  className={`absolute top-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-sky-500/70 transition-colors z-30 ${
                    isResizing ? 'bg-sky-500/70' : ''
                  }`}
                  onMouseDown={handleResizeStart}
                >
                  <div className="absolute left-1/2 -translate-x-1/2 top-0 flex flex-col gap-0.5">
                    <div className="w-8 h-0.5 bg-white/30 rounded" />
                    <div className="w-8 h-0.5 bg-white/30 rounded" />
                  </div>
                </div>
                <Timeline />
              </div>
            </main>
          </div>
        </div>

        {/* Mobile overlays */}
        {mobilePanel && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="absolute inset-0 bg-black/70"
              onClick={() => setMobilePanel(null)}
            />
            <div className="absolute inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl bg-[#0f1117] border-t border-white/10 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <div className="text-sm font-semibold">
                  {mobilePanel === 'tools' ? 'Tools' : 'Inspector'}
                </div>
                <button
                  onClick={() => setMobilePanel(null)}
                  className="p-2 rounded-lg hover:bg-white/10 text-white/70"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {mobilePanel === 'tools' ? (
                <div className="flex flex-col h-full">
                  <div className="flex items-center gap-1 p-2 border-b border-white/10 overflow-x-auto">
                    {panelTabs.map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setActivePanel(tab.id)}
                        className={`px-3 py-2 rounded-xl text-xs border whitespace-nowrap ${
                          activePanel === tab.id
                            ? 'bg-white/10 border-white/20 text-white'
                            : 'bg-white/0 border-white/10 text-white/60'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex-1 min-h-0 overflow-hidden">{renderPanel()}</div>
                </div>
              ) : (
                <PropertiesPanel />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeDragId && (
          <div className="px-3 py-2 bg-white/10 border border-white/20 text-white text-sm rounded-xl shadow-2xl backdrop-blur">
            Moving clip…
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
