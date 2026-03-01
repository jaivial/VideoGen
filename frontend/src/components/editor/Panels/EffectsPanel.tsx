import { useEffect, useMemo, useState } from 'react'
import { useEditorStore, useSelectedClips, useTracks } from '../../../stores/editorStore'

const FILTERS = [
  { id: 'brightness', name: 'Brightness', min: -100, max: 100, default: 0 },
  { id: 'contrast', name: 'Contrast', min: -100, max: 100, default: 0 },
  { id: 'saturation', name: 'Saturation', min: -100, max: 100, default: 0 },
  { id: 'temperature', name: 'Temperature', min: -100, max: 100, default: 0 },
  { id: 'blur', name: 'Blur', min: 0, max: 20, default: 0 },
] as const

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
  const tracks = useTracks()
  const { updateClip } = useEditorStore()
  const [activeTab, setActiveTab] = useState<'filters' | 'transitions'>('filters')
  const [filterValues, setFilterValues] = useState<Record<string, number>>({})

  const selectedClip = useMemo(() => {
    if (selectedClips.length === 0) return null
    const selectedId = selectedClips[0]
    for (const track of tracks) {
      const clip = track.clips.find((candidate) => candidate.id === selectedId)
      if (clip) return clip
    }
    return null
  }, [selectedClips, tracks])

  const canApplyFilters = selectedClip !== null && (selectedClip.type === 'video' || selectedClip.type === 'image')
  const canApplyTransitions = canApplyFilters

  const currentTransition = useMemo(() => {
    if (!selectedClip || !canApplyTransitions) return null
    const effects = Array.isArray((selectedClip as any).effects) ? (selectedClip as any).effects : []
    return effects.find((effect: any) => effect?.type === 'transition') || null
  }, [selectedClip, canApplyTransitions])

  const transitionStyle = useMemo(() => {
    const style = String(currentTransition?.params?.style || '').trim()
    return style || 'fade'
  }, [currentTransition])

  const transitionDuration = useMemo(() => {
    const duration = Number(currentTransition?.params?.duration)
    return Number.isFinite(duration) ? Math.max(0, duration) : 0
  }, [currentTransition])

  useEffect(() => {
    if (!selectedClip || !canApplyFilters) {
      setFilterValues({})
      return
    }

    const currentValues: Record<string, number> = {}
    const effects = Array.isArray((selectedClip as any).effects) ? (selectedClip as any).effects : []
    for (const filter of FILTERS) {
      const effect = effects.find((candidate: any) => candidate?.type === filter.id)
      const value = Number(effect?.params?.value)
      currentValues[filter.id] = Number.isFinite(value) ? value : filter.default
    }
    setFilterValues(currentValues)
  }, [selectedClip, canApplyFilters])

  const handleFilterChange = (filterId: string, value: number) => {
    setFilterValues((prev) => ({ ...prev, [filterId]: value }))

    if (!selectedClip || !canApplyFilters) {
      return
    }

    const effects = Array.isArray((selectedClip as any).effects) ? [...(selectedClip as any).effects] : []
    const defaultValue = FILTERS.find((filter) => filter.id === filterId)?.default ?? 0
    const effectIndex = effects.findIndex((effect: any) => effect?.type === filterId)

    if (value === defaultValue) {
      if (effectIndex !== -1) effects.splice(effectIndex, 1)
      updateClip(selectedClip.id, { effects } as any)
      return
    }

    const effectPayload = {
      id: effectIndex !== -1 ? effects[effectIndex].id : `${filterId}-${selectedClip.id}`,
      type: filterId,
      name: FILTERS.find((filter) => filter.id === filterId)?.name || filterId,
      enabled: true,
      params: { value },
    }

    if (effectIndex !== -1) {
      effects[effectIndex] = effectPayload
    } else {
      effects.push(effectPayload)
    }

    updateClip(selectedClip.id, { effects } as any)
  }

  const handleTransitionSelect = (transitionId: string) => {
    if (!selectedClip || !canApplyTransitions) return

    const effects = Array.isArray((selectedClip as any).effects) ? [...(selectedClip as any).effects] : []
    const idx = effects.findIndex((effect: any) => effect?.type === 'transition')
    const transitionEffect = {
      id: idx !== -1 ? effects[idx].id : `transition-${selectedClip.id}`,
      type: 'transition',
      name: 'Transition',
      enabled: true,
      params: {
        style: transitionId,
        duration: transitionDuration > 0 ? transitionDuration : 0.5,
      },
    }
    if (idx !== -1) {
      effects[idx] = transitionEffect
    } else {
      effects.push(transitionEffect)
    }
    updateClip(selectedClip.id, { effects } as any)
  }

  const handleTransitionDurationChange = (duration: number) => {
    if (!selectedClip || !canApplyTransitions) return

    const effects = Array.isArray((selectedClip as any).effects) ? [...(selectedClip as any).effects] : []
    const idx = effects.findIndex((effect: any) => effect?.type === 'transition')

    if (duration <= 0.01) {
      if (idx !== -1) effects.splice(idx, 1)
      updateClip(selectedClip.id, { effects } as any)
      return
    }

    const transitionEffect = {
      id: idx !== -1 ? effects[idx].id : `transition-${selectedClip.id}`,
      type: 'transition',
      name: 'Transition',
      enabled: true,
      params: {
        style: transitionStyle,
        duration,
      },
    }
    if (idx !== -1) {
      effects[idx] = transitionEffect
    } else {
      effects.push(transitionEffect)
    }
    updateClip(selectedClip.id, { effects } as any)
  }

  const handleResetFilters = () => {
    if (!selectedClip || !canApplyFilters) return
    const resetValues: Record<string, number> = {}
    for (const filter of FILTERS) {
      resetValues[filter.id] = filter.default
    }
    setFilterValues(resetValues)

    const effects = Array.isArray((selectedClip as any).effects) ? [...(selectedClip as any).effects] : []
    const effectIds = new Set(FILTERS.map((filter) => filter.id))
    const remaining = effects.filter((effect: any) => !effectIds.has(effect?.type))
    updateClip(selectedClip.id, { effects: remaining } as any)
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
            {selectedClip && !canApplyFilters && (
              <div className="mb-4 p-3 bg-amber-900/30 border border-amber-700 rounded-lg">
                <p className="text-amber-300 text-xs">Filters can only be applied to video or image clips.</p>
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
                    disabled={!canApplyFilters}
                    className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
                  />
                </div>
              ))}
            </div>

            {/* Reset button */}
            {canApplyFilters && (
              <button
                onClick={handleResetFilters}
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
            {selectedClip && !canApplyTransitions && (
              <div className="mb-4 p-3 bg-amber-900/30 border border-amber-700 rounded-lg">
                <p className="text-amber-300 text-xs">Transitions can only be applied to video or image clips.</p>
              </div>
            )}

            {/* Transition grid */}
            <div className="grid grid-cols-2 gap-2">
              {TRANSITIONS.map((transition) => (
                <button
                  key={transition.id}
                  onClick={() => handleTransitionSelect(transition.id)}
                  disabled={!canApplyTransitions}
                  className={`p-4 rounded-lg text-center disabled:opacity-50 disabled:cursor-not-allowed ${
                    currentTransition && transitionStyle === transition.id
                      ? 'bg-cyan-600/30 border border-cyan-400/70'
                      : 'bg-gray-800 hover:bg-gray-700'
                  }`}
                >
                  <span className="text-2xl block mb-1">{transition.icon}</span>
                  <span className="text-xs text-gray-400">{transition.name}</span>
                </button>
              ))}
            </div>

            {canApplyTransitions && (
              <div className="mt-4 space-y-3">
                <div>
                  <div className="flex justify-between mb-1">
                    <label className="text-xs text-gray-400">Transition Duration</label>
                    <span className="text-xs text-gray-500">{transitionDuration.toFixed(2)}s</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={transitionDuration}
                    onChange={(e) => handleTransitionDurationChange(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-gray-600 mt-1">
                    <span>0s</span>
                    <span>2s</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
