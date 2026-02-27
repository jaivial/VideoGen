import { useMemo } from 'react'
import { useEditorStore, useSelectedClips, useTracks } from '../../../stores/editorStore'
import type { Clip } from '../../../types/editor'

export function PropertiesPanel() {
  const selectedClips = useSelectedClips()
  const tracks = useTracks()
  const { updateClip } = useEditorStore()

  // Get the selected clip data
  const selectedClip = useMemo(() => {
    if (selectedClips.length === 0) return null

    const clipId = selectedClips[0]
    for (const track of tracks) {
      const clip = track.clips.find(c => c.id === clipId)
      if (clip) return clip
    }
    return null
  }, [selectedClips, tracks])

  if (!selectedClip) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-gray-700">
          <h3 className="text-sm font-semibold text-white">Properties</h3>
        </div>
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm p-4 text-center">
          Select a clip to view its properties
        </div>
      </div>
    )
  }

  const handleVolumeChange = (value: number) => {
    updateClip(selectedClip.id, { volume: value / 100 })
  }

  const handleSpeedChange = (value: number) => {
    updateClip(selectedClip.id, { speed: value / 100 })
  }

  const handleTrimStartChange = (value: number) => {
    updateClip(selectedClip.id, { trimStart: value })
  }

  const handleTrimEndChange = (value: number) => {
    updateClip(selectedClip.id, { trimEnd: value })
  }

  // Get volume and speed values (default to 1 if not set)
  const volume = (selectedClip as any).volume ?? 1
  const speed = (selectedClip as any).speed ?? 1

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-700">
        <h3 className="text-sm font-semibold text-white">Properties</h3>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Clip Info */}
        <div>
          <h4 className="text-xs font-medium text-gray-400 mb-2">Clip Info</h4>
          <div className="bg-gray-800 rounded-lg p-3 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">Name:</span>
              <span className="text-white truncate ml-2">{selectedClip.name}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">Type:</span>
              <span className="text-white capitalize">{selectedClip.type}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">Duration:</span>
              <span className="text-white">{selectedClip.duration.toFixed(2)}s</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">Start:</span>
              <span className="text-white">{selectedClip.startTime.toFixed(2)}s</span>
            </div>
          </div>
        </div>

        {/* Volume */}
        {(selectedClip.type === 'video' || selectedClip.type === 'audio') && (
          <div>
            <h4 className="text-xs font-medium text-gray-400 mb-2">Volume</h4>
            <div className="space-y-2">
              <input
                type="range"
                min="0"
                max="200"
                value={volume * 100}
                onChange={(e) => handleVolumeChange(parseInt(e.target.value))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-xs text-gray-500">
                <span>0%</span>
                <span className="text-gray-400">{Math.round(volume * 100)}%</span>
                <span>200%</span>
              </div>
            </div>
          </div>
        )}

        {/* Speed */}
        {(selectedClip.type === 'video' || selectedClip.type === 'image') && (
          <div>
            <h4 className="text-xs font-medium text-gray-400 mb-2">Speed</h4>
            <div className="space-y-2">
              <input
                type="range"
                min="25"
                max="400"
                value={speed * 100}
                onChange={(e) => handleSpeedChange(parseInt(e.target.value))}
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
              <div className="flex justify-between text-xs text-gray-500">
                <span>0.25x</span>
                <span className="text-gray-400">{speed.toFixed(2)}x</span>
                <span>4x</span>
              </div>
            </div>
          </div>
        )}

        {/* Trim */}
        <div>
          <h4 className="text-xs font-medium text-gray-400 mb-2">Trim</h4>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500">In Point</label>
              <input
                type="number"
                min="0"
                max={selectedClip.duration}
                step="0.1"
                value={selectedClip.trimStart.toFixed(2)}
                onChange={(e) => handleTrimStartChange(parseFloat(e.target.value))}
                className="w-full mt-1 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500">Out Point</label>
              <input
                type="number"
                min="0"
                max={selectedClip.duration}
                step="0.1"
                value={selectedClip.trimEnd.toFixed(2)}
                onChange={(e) => handleTrimEndChange(parseFloat(e.target.value))}
                className="w-full mt-1 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white text-sm"
              />
            </div>
          </div>
        </div>

        {/* Effects Preview */}
        {(selectedClip as any).effects && (selectedClip as any).effects.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-gray-400 mb-2">Effects</h4>
            <div className="space-y-1">
              {(selectedClip as any).effects.map((effect: any, idx: number) => (
                <div key={idx} className="bg-gray-800 rounded px-3 py-2 text-xs text-gray-400">
                  {effect.name}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
