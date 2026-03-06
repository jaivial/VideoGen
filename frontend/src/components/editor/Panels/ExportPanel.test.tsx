import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExportPanel } from './ExportPanel'
import { useEditorStore } from '../../../stores/editorStore'

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
  state.initializeFromVideo('https://example.com/base.mp4', {
    duration: 24,
    width: 1080,
    height: 1920,
    fps: 60,
    name: 'Portrait Composition',
  })
}

describe('ExportPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetEditorStore()
  })

  it('uses the current composition settings as the default export settings', () => {
    render(<ExportPanel videoId="123" />)

    expect(screen.getByRole('combobox', { name: /resolution/i })).toHaveAttribute('aria-haspopup', 'listbox')
    expect(screen.getByRole('combobox', { name: /resolution/i })).toHaveTextContent(/9:16/i)
    expect(screen.getByRole('combobox', { name: /frame rate/i })).toHaveTextContent(/60 fps/i)
    expect(document.querySelector('select')).not.toBeInTheDocument()
    expect(screen.getByText(/Portrait 9:16/i)).toBeInTheDocument()
  })

  it('lets the user switch export presets quickly', () => {
    render(<ExportPanel videoId="123" />)

    chooseCustomOption(/resolution/i, /1:1 .*1080x1080/i)
    fireEvent.click(screen.getByRole('button', { name: /square 1:1/i }))

    expect(screen.getByRole('combobox', { name: /resolution/i })).toHaveTextContent(/1080x1080/i)
  })
})
