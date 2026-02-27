import { useState } from 'react'
import { useSelectedClips } from '../../../stores/editorStore'

const FILTERS = [
  { id: 'brightness', name: 'Brightness', min: -100, max: 100, default: 0 },
  { id: 'contrast', name: 'Contrast', min: -100, max: 100, default: 0 },
  { id: 'saturation', name: 'Saturation', min: -100, max: 100, default: 0 },
  { id: 'temperature', name: 'Temperature', min: -100, max: 100, default: 0 },
  { id: 'blur', name: 'Blur', min: 0, max: 20, default: 0 },
]

const TRANSITIONS = [
  { id: 'fade', name: 'Fade', icon: '◐' },
  { id: 'dissolve', name: 'Dissolve', icon: '◑' },
  { id: 'wipe-left', name: 'Wipe Left', icon: '◧' },
  { id: 'wipe-right', name: 'Wipe Right', icon: '◨' },
  { id: 'slide-up', name: 'Slide Up', icon: '▲' },
  { id: 'slide-down', name: 'Slide Down', icon: '▼' },
]

export function EffectsPanel() {
  const selectedClips = useSelectedClips()
  const [activeTab, setActiveTab] = useState<'filters' | 'transitions'>('filters')
  const [filterValues, setFilterValues] = useState<Record<string, number>>({})

  const handleFilterChange = (filterId: string, value: number) => {
    setFilterValues((prev) => ({ ...prev, [filterId]: value }))

    // Apply to selected clip if any
    if (selectedClips.length > 0) {
      const clipId = selectedClips[0]
      // In a real implementation, this would update the clip's effects
      console.log('Applying filter:', filterId, value, 'to clip:', clipId)
    }
  }

  const handleTransitionSelect = (transitionId: string) => {
    if (selectedClips.length > 0) {
      console.log('Applying transition:', transitionId, 'to clip:', selectedClips[0])
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex border-b border-gray-700">
        <button
          onClick={() => setActiveTab('filters')}
          className={`flex-1 px-4 py-3 text-sm font-medium ${
            activeTab === 'filters'
              ? 'text-white border-b-2 border-blue-500'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Filters
        </button>
        <button
          onClick={() => setActiveTab('transitions')}
          className={`flex-1 px-4 py-3 text-sm font-medium ${
            activeTab === 'transitions'
              ? 'text-white border-b-2 border-blue-500'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Transitions
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'filters' ? (
          <>
            {/* Selected clip indicator */}
            {selectedClips.length === 0 && (
              <div className="mb-4 p-3 bg-yellow-900/30 border border-yellow-700 rounded-lg">
                <p className="text-yellow-400 text-xs">Select a clip to apply filters</p>
              </div>
            )}

            {/* Filter sliders */}
            <div className="space-y-4">
              {FILTERS.map((filter) => (
                <div key={filter.id}>
                  <div className="flex justify-between mb-1">
                    <label className="text-xs text-gray-400">{filter.name}</label>
                    <span className="text-xs text-gray-500">
                      {filterValues[filter.id] ?? filter.default}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={filter.min}
                    max={filter.max}
                    value={filterValues[filter.id] ?? filter.default}
                    onChange={(e) => handleFilterChange(filter.id, parseInt(e.target.value))}
                    disabled={selectedClips.length === 0}
                    className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
                  />
                </div>
              ))}
            </div>

            {/* Reset button */}
            {selectedClips.length > 0 && (
              <button
                onClick={() => setFilterValues({})}
                className="mt-4 w-full py-2 text-sm text-gray-400 hover:text-white border border-gray-700 rounded-lg hover:border-gray-500"
              >
                Reset Filters
              </button>
            )}
          </>
        ) : (
          <>
            {/* Selected clip indicator */}
            {selectedClips.length === 0 && (
              <div className="mb-4 p-3 bg-yellow-900/30 border border-yellow-700 rounded-lg">
                <p className="text-yellow-400 text-xs">Select a clip to add transitions</p>
              </div>
            )}

            {/* Transition grid */}
            <div className="grid grid-cols-2 gap-2">
              {TRANSITIONS.map((transition) => (
                <button
                  key={transition.id}
                  onClick={() => handleTransitionSelect(transition.id)}
                  disabled={selectedClips.length === 0}
                  className="p-4 bg-gray-800 hover:bg-gray-700 rounded-lg text-center disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="text-2xl block mb-1">{transition.icon}</span>
                  <span className="text-xs text-gray-400">{transition.name}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
