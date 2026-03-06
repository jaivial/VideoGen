import { useState, type ReactNode } from 'react'
import { CAPTION_STYLE_PRESETS, DEFAULT_CAPTION_STYLE, type CaptionAlignment, type CaptionAnimation, type CaptionBoxStyle, type CaptionPosition, type CaptionStyle, type CaptionTextTransform } from '../../../types/editor'
import { CustomSelect } from '../../ui/CustomSelect'

type CaptionStyleTab = 'typography' | 'layout' | 'appearance' | 'motion' | 'quick-styles'

const CAPTION_FONTS = ['Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Verdana', 'Courier New']
const CAPTION_POSITIONS: CaptionPosition[] = ['top', 'center', 'bottom']
const CAPTION_ALIGNMENTS: CaptionAlignment[] = ['left', 'center', 'right']
const CAPTION_ANIMATIONS: CaptionAnimation[] = ['none', 'fade', 'typewriter', 'pop', 'slide-up', 'slide-down']
const CAPTION_TRANSFORMS: CaptionTextTransform[] = ['none', 'uppercase', 'lowercase', 'capitalize']
const CAPTION_BOX_STYLES: CaptionBoxStyle[] = ['none', 'solid', 'pill']
const TAB_LABELS: Array<{ id: CaptionStyleTab; label: string }> = [
  { id: 'typography', label: 'Typography' },
  { id: 'layout', label: 'Layout' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'motion', label: 'Motion' },
  { id: 'quick-styles', label: 'Quick Styles' },
]

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function NumberField({
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
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm"
      />
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

interface CaptionStyleEditorProps {
  style: CaptionStyle
  onChange: (style: CaptionStyle) => void
}

export function CaptionStyleEditor({ style, onChange }: CaptionStyleEditorProps) {
  const [activeTab, setActiveTab] = useState<CaptionStyleTab>('typography')
  const resolvedStyle = { ...DEFAULT_CAPTION_STYLE, ...style }

  const updateStyle = (updates: Partial<CaptionStyle>) => {
    onChange({ ...resolvedStyle, ...updates })
  }

  return (
    <div className="mt-3 rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/5 p-4 space-y-4">
      <div className="flex flex-wrap gap-2">
        {TAB_LABELS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
              activeTab === tab.id
                ? 'border-fuchsia-400/50 bg-fuchsia-500/15 text-white'
                : 'border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'typography' && (
        <div className="space-y-4">
          <Section title="Typography">
            <div className="grid grid-cols-2 gap-3">
              <CustomSelect
                id="caption-font-family"
                label="Font Family"
                value={resolvedStyle.fontFamily}
                onChange={(value) => updateStyle({ fontFamily: value })}
                options={CAPTION_FONTS.map((font) => ({ value: font, label: font }))}
                containerClassName="col-span-2"
                labelClassName="text-xs text-gray-400"
              />
              <NumberField id="caption-font-size" label="Font Size" min={12} max={120} step={1} value={resolvedStyle.fontSize} onChange={(value) => updateStyle({ fontSize: clamp(value || 0, 12, 120) })} />
              <NumberField id="caption-font-weight" label="Font Weight" min={300} max={900} step={100} value={resolvedStyle.fontWeight} onChange={(value) => updateStyle({ fontWeight: clamp(value || 0, 300, 900) })} />
              <NumberField id="caption-letter-spacing" label="Letter Spacing" min={-2} max={12} step={0.1} value={resolvedStyle.letterSpacing} onChange={(value) => updateStyle({ letterSpacing: clamp(value || 0, -2, 12) })} />
              <NumberField id="caption-line-height" label="Line Height" min={1} max={2.4} step={0.05} value={resolvedStyle.lineHeight} onChange={(value) => updateStyle({ lineHeight: clamp(value || 0, 1, 2.4) })} />
            </div>
          </Section>

          <Section title="Text Treatment">
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => updateStyle({ italic: !resolvedStyle.italic })} className={`rounded-lg border px-3 py-2 text-xs font-medium ${resolvedStyle.italic ? 'border-fuchsia-400/50 bg-fuchsia-500/15 text-white' : 'border-gray-700 bg-gray-800 text-gray-300'}`}>
                Italic
              </button>
              <button type="button" onClick={() => updateStyle({ underline: !resolvedStyle.underline })} className={`rounded-lg border px-3 py-2 text-xs font-medium ${resolvedStyle.underline ? 'border-fuchsia-400/50 bg-fuchsia-500/15 text-white' : 'border-gray-700 bg-gray-800 text-gray-300'}`}>
                Underline
              </button>
            </div>
            <CustomSelect
              id="caption-text-transform"
              label="Text Transform"
              value={resolvedStyle.textTransform}
              onChange={(value) => updateStyle({ textTransform: value })}
              options={CAPTION_TRANSFORMS.map((transform) => ({ value: transform, label: transform }))}
              containerClassName="mt-3"
              labelClassName="text-xs text-gray-400"
            />
          </Section>
        </div>
      )}

      {activeTab === 'layout' && (
        <div className="space-y-4">
          <Section title="Anchor">
            <div className="grid grid-cols-3 gap-2">
              {CAPTION_POSITIONS.map((position) => (
                <button key={position} type="button" onClick={() => updateStyle({ position })} className={`rounded-lg border px-3 py-2 text-xs font-medium capitalize ${resolvedStyle.position === position ? 'border-fuchsia-400/50 bg-fuchsia-500/15 text-white' : 'border-gray-700 bg-gray-800 text-gray-300'}`}>
                  {position}
                </button>
              ))}
            </div>
          </Section>
          <Section title="Alignment">
            <div className="grid grid-cols-3 gap-2">
              {CAPTION_ALIGNMENTS.map((alignment) => (
                <button key={alignment} type="button" onClick={() => updateStyle({ alignment })} className={`rounded-lg border px-3 py-2 text-xs font-medium capitalize ${resolvedStyle.alignment === alignment ? 'border-fuchsia-400/50 bg-fuchsia-500/15 text-white' : 'border-gray-700 bg-gray-800 text-gray-300'}`}>
                  {alignment}
                </button>
              ))}
            </div>
          </Section>
          <Section title="Placement">
            <div className="grid grid-cols-2 gap-3">
              <NumberField id="caption-max-width" label="Max Width (%)" min={30} max={100} step={1} value={resolvedStyle.maxWidthPercent} onChange={(value) => updateStyle({ maxWidthPercent: clamp(value || 0, 30, 100) })} />
              <NumberField id="caption-offset-x" label="Offset X" min={-600} max={600} step={1} value={resolvedStyle.offsetX} onChange={(value) => updateStyle({ offsetX: clamp(value || 0, -600, 600) })} />
              <NumberField id="caption-offset-y" label="Offset Y" min={-400} max={400} step={1} value={resolvedStyle.offsetY} onChange={(value) => updateStyle({ offsetY: clamp(value || 0, -400, 400) })} />
            </div>
          </Section>
        </div>
      )}

      {activeTab === 'appearance' && (
        <div className="space-y-4">
          <Section title="Fill">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="caption-text-color" className="text-xs text-gray-400">Text Color</label>
                <input id="caption-text-color" aria-label="Text Color" type="color" value={resolvedStyle.color} onChange={(e) => updateStyle({ color: e.target.value })} className="mt-1 h-10 w-full rounded-lg border border-gray-700 bg-gray-800 p-1" />
              </div>
              <NumberField id="caption-opacity" label="Opacity" min={0} max={1} step={0.05} value={resolvedStyle.opacity} onChange={(value) => updateStyle({ opacity: clamp(value || 0, 0, 1) })} />
            </div>
          </Section>

          <Section title="Stroke & Shadow">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="caption-stroke-color" className="text-xs text-gray-400">Stroke Color</label>
                <input id="caption-stroke-color" aria-label="Stroke Color" type="color" value={resolvedStyle.strokeColor} onChange={(e) => updateStyle({ strokeColor: e.target.value })} className="mt-1 h-10 w-full rounded-lg border border-gray-700 bg-gray-800 p-1" />
              </div>
              <NumberField id="caption-stroke-width" label="Stroke Width" min={0} max={8} step={0.5} value={resolvedStyle.strokeWidth} onChange={(value) => updateStyle({ strokeWidth: clamp(value || 0, 0, 8) })} />
              <div>
                <label htmlFor="caption-shadow-color" className="text-xs text-gray-400">Shadow Color</label>
                <input id="caption-shadow-color" aria-label="Shadow Color" type="color" value={resolvedStyle.shadowColor} onChange={(e) => updateStyle({ shadowColor: e.target.value })} className="mt-1 h-10 w-full rounded-lg border border-gray-700 bg-gray-800 p-1" />
              </div>
              <NumberField id="caption-shadow-blur" label="Shadow Blur" min={0} max={24} step={1} value={resolvedStyle.shadowBlur} onChange={(value) => updateStyle({ shadowBlur: clamp(value || 0, 0, 24) })} />
            </div>
          </Section>

          <Section title="Background Box">
            <div className="grid grid-cols-2 gap-3">
              <CustomSelect
                id="caption-box-style"
                label="Box Style"
                value={resolvedStyle.boxStyle}
                onChange={(value) => updateStyle({ boxStyle: value })}
                options={CAPTION_BOX_STYLES.map((boxStyle) => ({ value: boxStyle, label: boxStyle }))}
                containerClassName="col-span-2"
                labelClassName="text-xs text-gray-400"
              />
              <div>
                <label htmlFor="caption-background-color" className="text-xs text-gray-400">Background Color</label>
                <input id="caption-background-color" aria-label="Background Color" type="color" value={resolvedStyle.backgroundColor} onChange={(e) => updateStyle({ backgroundColor: e.target.value })} className="mt-1 h-10 w-full rounded-lg border border-gray-700 bg-gray-800 p-1" />
              </div>
              <NumberField id="caption-background-opacity" label="Background Opacity" min={0} max={1} step={0.05} value={resolvedStyle.backgroundOpacity} onChange={(value) => updateStyle({ backgroundOpacity: clamp(value || 0, 0, 1) })} />
              <NumberField id="caption-padding-x" label="Padding X" min={0} max={60} step={1} value={resolvedStyle.paddingX} onChange={(value) => updateStyle({ paddingX: clamp(value || 0, 0, 60) })} />
              <NumberField id="caption-padding-y" label="Padding Y" min={0} max={40} step={1} value={resolvedStyle.paddingY} onChange={(value) => updateStyle({ paddingY: clamp(value || 0, 0, 40) })} />
              <NumberField id="caption-border-radius" label="Corner Radius" min={0} max={40} step={1} value={resolvedStyle.borderRadius} onChange={(value) => updateStyle({ borderRadius: clamp(value || 0, 0, 40) })} />
            </div>
          </Section>
        </div>
      )}

      {activeTab === 'motion' && (
        <Section title="Motion">
          <CustomSelect
            id="caption-animation"
            label="Animation"
            value={resolvedStyle.animation}
            onChange={(value) => updateStyle({ animation: value })}
            options={CAPTION_ANIMATIONS.map((animation) => ({ value: animation, label: animation }))}
            labelClassName="text-xs text-gray-400"
          />
          <div className="grid grid-cols-2 gap-3 mt-3">
            <NumberField id="caption-animation-duration" label="Animation Duration" min={0} max={2} step={0.05} value={resolvedStyle.animationDuration} onChange={(value) => updateStyle({ animationDuration: clamp(value || 0, 0, 2) })} />
            <NumberField id="caption-animation-strength" label="Animation Strength" min={0} max={1.5} step={0.05} value={resolvedStyle.animationStrength} onChange={(value) => updateStyle({ animationStrength: clamp(value || 0, 0, 1.5) })} />
          </div>
        </Section>
      )}

      {activeTab === 'quick-styles' && (
        <div className="grid grid-cols-1 gap-3">
          {CAPTION_STYLE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => updateStyle(preset.style)}
              className="rounded-xl border border-gray-700 bg-gray-800/80 px-4 py-3 text-left transition-colors hover:border-fuchsia-400/50 hover:text-white"
            >
              <div className="text-sm font-medium text-white">{preset.label}</div>
              <div className="mt-1 text-xs text-gray-400">{preset.description}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
