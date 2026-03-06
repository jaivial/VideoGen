import { useState } from 'react'
import { useCurrentTime, useEditorStore, useSelectedClips } from '../../../stores/editorStore'
import type { CaptionClip } from '../../../types/editor'
import { CaptionStyleEditor } from './CaptionStyleEditor'

export function CaptionsPanel() {
  const currentTime = useCurrentTime()
  const selectedClips = useSelectedClips()
  const { tracks, addCaption, updateCaption, removeCaption, selectClip } = useEditorStore()

  // Get all caption clips
  const captions = tracks
    .find((t) => t.type === 'caption')?.clips.filter((c) => c.type === 'caption') as CaptionClip[] || []

  const handleAddCaption = () => {
    addCaption(currentTime, currentTime + 3, 'New caption')
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Captions</h3>
        <button
          onClick={handleAddCaption}
          className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded"
        >
          + Add Caption
        </button>
      </div>

      {/* Captions list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {captions.length === 0 ? (
          <div className="text-center text-gray-500 text-sm py-8">
            No captions yet. Click "Add Caption" to create one.
          </div>
        ) : (
          captions.map((caption) => (
            <CaptionItem
              key={caption.id}
              caption={caption}
              onUpdate={(updates) => updateCaption(caption.id, updates)}
              onDelete={() => removeCaption(caption.id)}
              onOpenStyle={() => {
                selectClip(caption.id)
              }}
              isActive={currentTime >= caption.startTime && currentTime <= caption.startTime + caption.duration}
              isSelected={selectedClips.includes(caption.id)}
            />
          ))
        )}
      </div>
    </div>
  )
}

interface CaptionItemProps {
  caption: CaptionClip
  onUpdate: (updates: Partial<CaptionClip>) => void
  onDelete: () => void
  onOpenStyle: () => void
  isActive: boolean
  isSelected: boolean
}

function CaptionItem({ caption, onUpdate, onDelete, onOpenStyle, isActive, isSelected }: CaptionItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [showStyleEditor, setShowStyleEditor] = useState(false)

  return (
    <div
      className={`p-3 rounded-lg bg-gray-800 border ${
        isSelected ? 'border-fuchsia-400' : isActive ? 'border-blue-500' : 'border-gray-700'
      }`}
    >
      {/* Text input */}
      {isEditing ? (
        <textarea
          value={caption.text}
          onChange={(e) => onUpdate({ text: e.target.value })}
          onBlur={() => setIsEditing(false)}
          autoFocus
          className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
          rows={2}
        />
      ) : (
        <div
          onClick={() => setIsEditing(true)}
          className="text-sm text-white cursor-text min-h-[2.5rem] flex items-center"
        >
          {caption.text || 'Click to edit...'}
        </div>
      )}

      {/* Time controls */}
      <div className="flex items-center gap-2 mt-2">
        <input
          type="number"
          value={caption.startTime.toFixed(1)}
          onChange={(e) => onUpdate({ startTime: parseFloat(e.target.value) })}
          className="w-16 px-2 py-1 text-xs bg-gray-700 text-gray-300 rounded"
          step="0.1"
        />
        <span className="text-gray-500">-</span>
        <input
          type="number"
          value={(caption.startTime + caption.duration).toFixed(1)}
          onChange={(e) => {
            const endTime = parseFloat(e.target.value)
            onUpdate({ duration: endTime - caption.startTime })
          }}
          className="w-16 px-2 py-1 text-xs bg-gray-700 text-gray-300 rounded"
          step="0.1"
        />
        <span className="text-gray-500 text-xs">({caption.duration.toFixed(1)}s)</span>

        <button
          onClick={() => {
            onOpenStyle()
            setShowStyleEditor((open) => !open)
          }}
          className="ml-auto rounded-md border border-fuchsia-500/30 bg-fuchsia-500/10 px-2 py-1 text-[11px] font-medium text-fuchsia-200 hover:border-fuchsia-400/50 hover:text-white"
        >
          {showStyleEditor ? 'Hide Style' : 'Edit Style'}
        </button>

        {/* Delete button */}
        <button
          onClick={onDelete}
          className="p-1 text-gray-400 hover:text-red-400"
          title="Delete"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      {showStyleEditor && (
        <CaptionStyleEditor
          style={caption.style}
          onChange={(style) => onUpdate({ style })}
        />
      )}
    </div>
  )
}
