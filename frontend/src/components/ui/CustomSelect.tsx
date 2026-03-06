import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

export interface CustomSelectOption<T extends string | number> {
  value: T
  label: string
  description?: string
}

interface CustomSelectProps<T extends string | number> {
  id: string
  label: string
  value: T
  onChange: (value: T) => void
  options: Array<CustomSelectOption<T>>
  containerClassName?: string
  labelClassName?: string
  triggerClassName?: string
  menuClassName?: string
  optionClassName?: string
  optionSelectedClassName?: string
  labelStyle?: CSSProperties
  triggerStyle?: CSSProperties
  menuStyle?: CSSProperties
  optionStyle?: CSSProperties
  optionSelectedStyle?: CSSProperties
}

const defaultTriggerClassName = 'w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-800 text-left text-sm text-white flex items-center justify-between gap-3 focus:outline-none focus:ring-2 focus:ring-blue-500'
const defaultMenuClassName = 'absolute z-50 mt-2 w-full overflow-hidden rounded-xl border border-gray-700 bg-gray-900 shadow-2xl'
const defaultOptionClassName = 'w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-white/5'
const defaultSelectedClassName = 'bg-blue-500/15 text-white'

export function CustomSelect<T extends string | number>({
  id,
  label,
  value,
  onChange,
  options,
  containerClassName = '',
  labelClassName = 'block text-sm font-medium mb-2',
  triggerClassName = defaultTriggerClassName,
  menuClassName = defaultMenuClassName,
  optionClassName = defaultOptionClassName,
  optionSelectedClassName = defaultSelectedClassName,
  labelStyle,
  triggerStyle,
  menuStyle,
  optionStyle,
  optionSelectedStyle,
}: CustomSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const labelId = `${id}-label`
  const triggerId = `${id}-trigger`
  const listboxId = `${id}-listbox`

  const selectedOption = useMemo(() => {
    return options.find((option) => option.value === value) ?? options[0]
  }, [options, value])

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen])

  return (
    <div ref={rootRef} className={`relative ${containerClassName}`}>
      <label id={labelId} htmlFor={triggerId} className={labelClassName} style={labelStyle}>
        {label}
      </label>
      <button
        id={triggerId}
        type="button"
        role="combobox"
        aria-label={label}
        aria-labelledby={`${labelId} ${triggerId}`}
        aria-controls={listboxId}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={() => setIsOpen((open) => !open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setIsOpen(true)
          }
        }}
        className={triggerClassName}
        style={triggerStyle}
      >
        <span className="truncate">{selectedOption?.label ?? ''}</span>
        <svg className={`h-4 w-4 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="none" stroke="currentColor">
          <path d="M5 7.5l5 5 5-5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {isOpen && (
        <div id={listboxId} role="listbox" aria-labelledby={labelId} className={menuClassName} style={menuStyle}>
          {options.map((option) => {
            const isSelected = option.value === value
            return (
              <button
                key={String(option.value)}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`${optionClassName} ${isSelected ? optionSelectedClassName : ''}`.trim()}
                style={isSelected ? { ...optionStyle, ...optionSelectedStyle } : optionStyle}
                onClick={() => {
                  onChange(option.value)
                  setIsOpen(false)
                }}
              >
                <div>{option.label}</div>
                {option.description && <div className="mt-0.5 text-xs text-gray-400">{option.description}</div>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
