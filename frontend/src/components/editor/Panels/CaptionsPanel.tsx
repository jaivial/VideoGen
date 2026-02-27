import { useState } from 'react'
import { useEditorStore, useCurrentTime } from '../../../stores/editorStore'
import type { CaptionClip } from '../../../types/editor'

export function CaptionsPanel() {
  const currentTime = useCurrentTime()
  const { tracks, addCaption, updateCaption, removeCaption } = useEditorStore()

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
              isActive={currentTime >= caption.startTime && currentTime <= caption.startTime + caption.duration}
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
  isActive: boolean
}

function CaptionItem({ caption, onUpdate, onDelete, isActive }: CaptionItemProps) {
  const [isEditing, setIsEditing] = useState(false)

  return (
    <div
      className={`p-3 rounded-lg bg-gray-800 border ${
        isActive ? 'border-blue-500' : 'border-gray-700'
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

        {/* Style button */}
        <button
          onClick={() => {/* Open style editor */}}
          className="ml-auto p-1 text-gray-400 hover:text-white"
          title="Edit style"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
          </svg>
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
    </div>
  )
}
