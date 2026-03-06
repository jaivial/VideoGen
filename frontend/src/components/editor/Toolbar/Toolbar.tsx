import { PanelLeftOpen, PanelRightOpen } from 'lucide-react'
import { useEditorStore, useActiveTool, useIsPlaying, useCurrentTime, useDuration, useSelectedClips } from '../../../stores/editorStore'
import type { EditorTool } from '../../../types/editor'

interface ToolbarProps {
  leftSidebarOpen?: boolean
  rightSidebarOpen?: boolean
  onOpenLeftSidebar?: () => void
  onOpenRightSidebar?: () => void
  testId?: string
}

export function Toolbar({ leftSidebarOpen = true, rightSidebarOpen = true, onOpenLeftSidebar, onOpenRightSidebar, testId }: ToolbarProps = {}) {
  const activeTool = useActiveTool()
  const isPlaying = useIsPlaying()
  const currentTime = useCurrentTime()
  const duration = useDuration()
  const selectedClips = useSelectedClips()

  const { setActiveTool, togglePlayPause, splitClip, removeClip, undo, redo, canUndo, canRedo, addTrack, setCurrentTime } = useEditorStore()

  const tools: { id: EditorTool; label: string; icon: React.ReactNode; shortcut: string }[] = [
    {
      id: 'select',
      label: 'Select',
      shortcut: 'V',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
        </svg>
      ),
    },
    {
      id: 'blade',
      label: 'Blade',
      shortcut: 'B',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
        </svg>
      ),
    },
    {
      id: 'trim',
      label: 'Trim',
      shortcut: 'T',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
        </svg>
      ),
    },
    {
      id: 'text',
      label: 'Text',
      shortcut: 'Ctrl+T',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      ),
    },
  ]

  // Keyboard shortcuts
  // This effect should be handled at a higher level, but for now we just render the toolbar

  return (
    <div data-testid={testId} className="flex items-center justify-between gap-3 px-4 py-2 bg-gray-800 border-b border-gray-700">
      {/* Left: Tools */}
      <div className="flex items-center gap-1 min-w-0">
        {!leftSidebarOpen && onOpenLeftSidebar && (
          <button
            type="button"
            onClick={onOpenLeftSidebar}
            title="Show media library"
            className="px-3 py-2 rounded-md text-sm text-gray-300 hover:text-white hover:bg-gray-700 border border-gray-700 flex items-center gap-2"
          >
            <PanelLeftOpen className="w-4 h-4" />
            <span className="hidden xl:inline">Media Library</span>
          </button>
        )}

        {/* Tool buttons */}
        <div className="flex items-center gap-0.5 bg-gray-700 rounded-lg p-0.5">
          {tools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => setActiveTool(tool.id)}
              className={`p-2 rounded-md transition-colors ${
                activeTool === tool.id
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-600'
              }`}
              title={`${tool.label} (${tool.shortcut})`}
            >
              {tool.icon}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-gray-600 mx-2" />

        {/* Edit actions */}
        <div className="flex items-center gap-0.5">
          {/* Undo */}
          <button
            onClick={undo}
            disabled={!canUndo()}
            className="p-2 rounded-md text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Undo (Ctrl+Z)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
          </button>

          {/* Redo */}
          <button
            onClick={redo}
            disabled={!canRedo()}
            className="p-2 rounded-md text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Redo (Ctrl+Shift+Z)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
            </svg>
          </button>
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-gray-600 mx-2" />

        {/* Clip actions */}
        <div className="flex items-center gap-0.5">
          {/* Split */}
          <button
            onClick={() => {
              if (selectedClips.length > 0) {
                splitClip(selectedClips[0], currentTime)
              }
            }}
            disabled={selectedClips.length === 0}
            className="p-2 rounded-md text-gray-400 hover:text-white hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Split at playhead (Ctrl+B)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
            </svg>
          </button>

          {/* Delete */}
          <button
            onClick={() => {
              selectedClips.forEach((id) => removeClip(id))
            }}
            disabled={selectedClips.length === 0}
            className="p-2 rounded-md text-gray-400 hover:text-red-400 hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Delete (Del)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Center: Playback controls */}
      <div className="flex items-center gap-2">
        {/* Go to start */}
        <button
          onClick={() => setCurrentTime(0)}
          className="p-2 rounded-md text-gray-400 hover:text-white hover:bg-gray-700"
          title="Go to start (Home)"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
          </svg>
        </button>

        {/* Play/Pause */}
        <button
          onClick={togglePlayPause}
          className="w-10 h-10 rounded-full bg-blue-600 hover:bg-blue-500 flex items-center justify-center transition-colors"
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        >
          {isPlaying ? (
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Go to end */}
        <button
          onClick={() => setCurrentTime(duration)}
          className="p-2 rounded-md text-gray-400 hover:text-white hover:bg-gray-700"
          title="Go to end (End)"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
          </svg>
        </button>
      </div>

      {/* Right: Add track / Export */}
      <div className="flex items-center gap-2 shrink-0">
        {!rightSidebarOpen && onOpenRightSidebar && (
          <button
            type="button"
            onClick={onOpenRightSidebar}
            title="Show properties"
            className="px-3 py-2 rounded-md text-sm text-gray-300 hover:text-white hover:bg-gray-700 border border-gray-700 flex items-center gap-2"
          >
            <span className="hidden xl:inline">Properties</span>
            <PanelRightOpen className="w-4 h-4" />
          </button>
        )}

        {/* Add track menu */}
        <div className="relative group">
          <button className="px-3 py-1.5 rounded-md text-sm text-gray-300 hover:text-white hover:bg-gray-700 flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Track
          </button>

          <div className="absolute right-0 top-full mt-1 w-40 bg-gray-700 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
            <button
              onClick={() => addTrack('video')}
              className="w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-600 hover:text-white rounded-t-lg"
            >
              Video Track
            </button>
            <button
              onClick={() => addTrack('audio')}
              className="w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-600 hover:text-white"
            >
              Audio Track
            </button>
            <button
              onClick={() => addTrack('caption')}
              className="w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-600 hover:text-white rounded-b-lg"
            >
              Caption Track
            </button>
          </div>
        </div>

        {/* Export */}
        <button className="px-3 py-1.5 rounded-md text-sm bg-green-600 hover:bg-green-500 text-white flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export
        </button>
      </div>
    </div>
  )
}
