import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PropertiesPanel } from './PropertiesPanel'
import { useEditorStore } from '../../../stores/editorStore'
import { RESOLUTIONS } from '../../../types/editor'

function chooseCustomOption(label: RegExp, option: RegExp) {
  fireEvent.click(screen.getByRole('combobox', { name: label }))
  fireEvent.click(screen.getByRole('option', { name: option }))
}

function resetEditorStore() {
  while (true) {
    const state = useEditorStore.getState()
    const trackWithClip = state.tracks.find((track) => track.clips.length > 0)
    if (!trackWithClip) break
    state.removeClip(trackWithClip.clips[0].id)
  }

  const state = useEditorStore.getState()
  state.setCurrentTime(0)
  state.setDuration(0)
  state.setZoom(50)
  state.setScrollX(0)
  state.deselectAll()
  state.selectTrack(null)
  state.setIsPlaying(false)
  state.setProjectName('Untitled Project')
  state.setProjectResolution(RESOLUTIONS[0])
  state.setProjectFrameRate(30)
}

describe('PropertiesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetEditorStore()
  })

  it('shows composition controls when no clip is selected', () => {
    render(<PropertiesPanel />)

    expect(screen.getByText('Composition Studio')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /portrait 9:16/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /frame rate/i })).toHaveAttribute('aria-haspopup', 'listbox')
    expect(document.querySelector('select')).not.toBeInTheDocument()
  })

  it('updates composition settings from the empty-state controls', () => {
    render(<PropertiesPanel />)

    fireEvent.click(screen.getByRole('button', { name: /portrait 9:16/i }))
    expect(useEditorStore.getState().project.resolution).toMatchObject({ width: 1080, height: 1920 })

    chooseCustomOption(/frame rate/i, /60 fps/i)
    expect(useEditorStore.getState().project.frameRate).toBe(60)

    fireEvent.change(screen.getByRole('spinbutton', { name: /duration/i }), { target: { value: '12.5' } })
    expect(useEditorStore.getState().duration).toBe(12.5)
  })

  it('keeps caption styling out of the properties sidebar when a caption clip is selected', () => {
    const state = useEditorStore.getState()
    state.addCaption(0, 3, 'Caption line')

    const captionTrack = useEditorStore.getState().tracks.find((track) => track.type === 'caption')!
    const caption = captionTrack.clips[0]
    useEditorStore.getState().selectClip(caption.id)

    render(<PropertiesPanel />)

    expect(screen.getByText('Clip Info')).toBeInTheDocument()
    expect(screen.queryByText('Caption Design')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /typography/i })).not.toBeInTheDocument()
  })

  it('still lets caption timing be edited from the generic properties sidebar', () => {
    const state = useEditorStore.getState()
    state.addCaption(0, 3, 'Caption line')

    const captionTrack = useEditorStore.getState().tracks.find((track) => track.type === 'caption')!
    const caption = captionTrack.clips[0]
    useEditorStore.getState().selectClip(caption.id)

    render(<PropertiesPanel />)

    fireEvent.change(screen.getByRole('spinbutton', { name: /start time/i }), { target: { value: '1.5' } })

    const updatedCaption = useEditorStore.getState().tracks.find((track) => track.type === 'caption')!.clips[0] as any
    expect(updatedCaption.startTime).toBe(1.5)
  })
})
