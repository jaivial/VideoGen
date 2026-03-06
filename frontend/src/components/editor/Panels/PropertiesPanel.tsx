import { useMemo, type ReactNode } from 'react'
import { useEditorStore, useSelectedClips, useTracks } from '../../../stores/editorStore'
import { COMPOSITION_PRESETS, RESOLUTIONS, getResolutionValue } from '../../../types/editor'
import { CustomSelect } from '../../ui/CustomSelect'

const compositionResolutionOptions = RESOLUTIONS.map((resolution) => ({
  value: getResolutionValue(resolution),
  label: `${resolution.label} (${resolution.width}x${resolution.height})`,
}))

const compositionFrameRateOptions = [24, 30, 60].map((fps) => ({
  value: fps,
  label: `${fps} fps`,
}))

function PanelShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-700">
        <h3 className="text-sm font-semibold text-white">Properties</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-6">{children}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-medium text-gray-400 mb-2">{title}</h4>
      {children}
    </div>
  )
}

function LabeledNumberInput({
  id,
  label,
  value,
  min,
  max,
  step = 0.1,
  onChange,
}: {
  id: string
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <div>
      <label htmlFor={id} className="text-xs text-gray-400">{label}</label>
      <input
        id={id}
        aria-label={label}
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
      />
    </div>
  )
}

function CompositionStudio({ minimumTimelineDuration }: { minimumTimelineDuration: number }) {
  const { project, duration, tracks, setDuration, setProjectResolution, setProjectFrameRate } = useEditorStore()

  return (
    <PanelShell>
      <div>
        <div className="flex items-center justify-between gap-3 mb-2">
          <div>
            <h4 className="text-sm font-semibold text-white">Composition Studio</h4>
            <p className="text-xs text-gray-400 mt-1">Remotion-style composition controls backed by FFmpeg rendering.</p>
          </div>
          <div className="px-2.5 py-1 rounded-full border border-cyan-500/20 bg-cyan-500/10 text-[11px] font-medium text-cyan-200">
            FFmpeg only
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 mt-4">
          {COMPOSITION_PRESETS.map((preset) => {
            const isActive = project.resolution.width === preset.resolution.width && project.resolution.height === preset.resolution.height
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  setProjectResolution(preset.resolution)
                  setProjectFrameRate(preset.frameRate)
                }}
                className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                  isActive
                    ? 'border-cyan-400/50 bg-cyan-500/10 text-white'
                    : 'border-gray-700 bg-gray-800/80 text-gray-300 hover:border-gray-500 hover:text-white'
                }`}
              >
                <div className="text-sm font-medium">{preset.label}</div>
                <div className="text-xs text-gray-400 mt-1">{preset.description} · {preset.resolution.width}×{preset.resolution.height} · {preset.frameRate} fps</div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-4">
        <CustomSelect
          id="composition-resolution"
          label="Resolution"
          value={getResolutionValue(project.resolution)}
          onChange={(value) => {
            const next = RESOLUTIONS.find((resolution) => getResolutionValue(resolution) == value)
            if (next) setProjectResolution(next)
          }}
          options={compositionResolutionOptions}
          labelClassName="text-xs text-gray-400"
          triggerClassName="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm flex items-center justify-between gap-3"
        />

        <CustomSelect
          id="composition-frame-rate"
          label="Frame Rate"
          value={project.frameRate}
          onChange={(value) => setProjectFrameRate(Number(value))}
          options={compositionFrameRateOptions}
          labelClassName="text-xs text-gray-400"
          triggerClassName="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm flex items-center justify-between gap-3"
        />

        <LabeledNumberInput
          id="composition-duration"
          label="Duration"
          min={minimumTimelineDuration}
          step={0.1}
          value={Number(duration.toFixed(1))}
          onChange={(value) => {
            if (!Number.isFinite(value)) return
            setDuration(Math.max(minimumTimelineDuration, value))
          }}
        />
        <p className="-mt-2 text-[11px] text-gray-500">Cannot be shorter than your current timeline footprint of {minimumTimelineDuration.toFixed(1)}s.</p>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
        <div className="text-xs uppercase tracking-[0.2em] text-gray-500">Composition Summary</div>
        <div className="text-sm font-medium text-white">{project.name}</div>
        <div className="grid grid-cols-2 gap-3 text-xs text-gray-300">
          <div>
            <div className="text-gray-500">Canvas</div>
            <div>{project.resolution.width}×{project.resolution.height}</div>
          </div>
          <div>
            <div className="text-gray-500">Frame rate</div>
            <div>{project.frameRate} fps</div>
          </div>
          <div>
            <div className="text-gray-500">Timeline</div>
            <div>{duration.toFixed(1)}s</div>
          </div>
          <div>
            <div className="text-gray-500">Tracks</div>
            <div>{tracks.length}</div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-xs text-amber-100">
        Tip: set the composition first, then add media and captions so the FFmpeg export matches the preview layout.
      </div>
    </PanelShell>
  )
}

function GenericClipInspector({ selectedClip }: { selectedClip: any }) {
  const { updateClip } = useEditorStore()
  const volume = selectedClip.volume ?? 1
  const speed = selectedClip.speed ?? 1
  const sourceDuration = Math.max(selectedClip.originalDuration ?? 0, selectedClip.trimEnd ?? 0, selectedClip.duration ?? 0)
  const fadeIn = selectedClip.fadeIn ?? 0
  const fadeOut = selectedClip.fadeOut ?? 0

  const updateNumeric = (updates: Record<string, number>) => {
    updateClip(selectedClip.id, updates as any)
  }

  return (
    <PanelShell>
      <Section title="Clip Info">
        <div className="bg-gray-800 rounded-lg p-3 space-y-2">
          <div className="flex justify-between text-xs"><span className="text-gray-400">Name:</span><span className="text-white truncate ml-2">{selectedClip.name}</span></div>
          <div className="flex justify-between text-xs"><span className="text-gray-400">Type:</span><span className="text-white capitalize">{selectedClip.type}</span></div>
          <div className="flex justify-between text-xs"><span className="text-gray-400">Duration:</span><span className="text-white">{selectedClip.duration.toFixed(2)}s</span></div>
          <div className="flex justify-between text-xs"><span className="text-gray-400">Start:</span><span className="text-white">{selectedClip.startTime.toFixed(2)}s</span></div>
          <div className="flex justify-between text-xs"><span className="text-gray-400">Source:</span><span className="text-white">{sourceDuration.toFixed(2)}s</span></div>
        </div>
      </Section>

      <Section title="Timeline">
        <LabeledNumberInput id="generic-start-time" label="Start Time" min={0} step={0.1} value={Number(selectedClip.startTime.toFixed(2))} onChange={(value) => updateNumeric({ startTime: Math.max(0, value) })} />
      </Section>

      {(selectedClip.type === 'video' || selectedClip.type === 'audio') && (
        <Section title="Volume">
          <div className="space-y-2">
            <input type="range" min="0" max="200" value={volume * 100} onChange={(e) => updateNumeric({ volume: parseInt(e.target.value, 10) / 100 })} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer" />
            <div className="flex justify-between text-xs text-gray-500"><span>0%</span><span className="text-gray-400">{Math.round(volume * 100)}%</span><span>200%</span></div>
          </div>
        </Section>
      )}

      {(selectedClip.type === 'video' || selectedClip.type === 'image') && (
        <Section title="Speed">
          <div className="space-y-2">
            <input type="range" min="25" max="400" value={speed * 100} onChange={(e) => updateNumeric({ speed: parseInt(e.target.value, 10) / 100 })} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer" />
            <div className="flex justify-between text-xs text-gray-500"><span>0.25x</span><span className="text-gray-400">{speed.toFixed(2)}x</span><span>4x</span></div>
          </div>
        </Section>
      )}

      <Section title="Trim">
        <div className="space-y-3">
          <LabeledNumberInput id="generic-trim-start" label="In Point" min={0} max={sourceDuration} step={0.1} value={Number(selectedClip.trimStart.toFixed(2))} onChange={(value) => updateNumeric({ trimStart: value })} />
          <LabeledNumberInput id="generic-trim-end" label="Out Point" min={0} max={sourceDuration} step={0.1} value={Number(selectedClip.trimEnd.toFixed(2))} onChange={(value) => updateNumeric({ trimEnd: value })} />
        </div>
      </Section>

      {selectedClip.type === 'audio' && (
        <Section title="Fades">
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1"><span>Fade In</span><span>{fadeIn.toFixed(2)}s</span></div>
              <input type="range" min="0" max={Math.max(0.1, selectedClip.duration)} step="0.05" value={fadeIn} onChange={(e) => updateNumeric({ fadeIn: parseFloat(e.target.value) })} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer" />
            </div>
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1"><span>Fade Out</span><span>{fadeOut.toFixed(2)}s</span></div>
              <input type="range" min="0" max={Math.max(0.1, selectedClip.duration)} step="0.05" value={fadeOut} onChange={(e) => updateNumeric({ fadeOut: parseFloat(e.target.value) })} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer" />
            </div>
          </div>
        </Section>
      )}

      {Array.isArray(selectedClip.effects) && selectedClip.effects.length > 0 && (
        <Section title="Effects">
          <div className="space-y-1">
            {selectedClip.effects.map((effect: any, idx: number) => (
              <div key={idx} className="bg-gray-800 rounded px-3 py-2 text-xs text-gray-400">{effect.name}</div>
            ))}
          </div>
        </Section>
      )}
    </PanelShell>
  )
}

export function PropertiesPanel() {
  const selectedClips = useSelectedClips()
  const tracks = useTracks()

  const minimumTimelineDuration = useMemo(() => {
    let maxEnd = 0
    for (const track of tracks) {
      for (const clip of track.clips) {
        maxEnd = Math.max(maxEnd, clip.startTime + clip.duration)
      }
    }
    return Math.round(maxEnd * 100) / 100
  }, [tracks])

  const selectedClip = useMemo(() => {
    if (selectedClips.length === 0) return null
    const clipId = selectedClips[0]
    for (const track of tracks) {
      const clip = track.clips.find((candidate) => candidate.id === clipId)
      if (clip) return clip
    }
    return null
  }, [selectedClips, tracks])

  if (!selectedClip) {
    return <CompositionStudio minimumTimelineDuration={minimumTimelineDuration} />
  }

  return <GenericClipInspector selectedClip={selectedClip} />
}
