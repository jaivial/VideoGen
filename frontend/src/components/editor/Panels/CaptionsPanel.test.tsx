import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CaptionsPanel } from './CaptionsPanel'
import { useEditorStore } from '../../../stores/editorStore'

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
}

describe('CaptionsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetEditorStore()
  })

  it('shows rich caption style controls inside the captions panel', () => {
    useEditorStore.getState().addCaption(0, 3, 'Caption line')

    render(<CaptionsPanel />)

    fireEvent.click(screen.getByRole('button', { name: /edit style/i }))

    expect(screen.getByRole('button', { name: 'Typography' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: /letter spacing/i })).toBeInTheDocument()
    expect(screen.queryByText(/style in properties/i)).not.toBeInTheDocument()
    expect(document.querySelector('select')).not.toBeInTheDocument()
  })

  it('updates caption style values from the inline caption style editor', () => {
    useEditorStore.getState().addCaption(0, 3, 'Caption line')

    render(<CaptionsPanel />)

    fireEvent.click(screen.getByRole('button', { name: /edit style/i }))
    fireEvent.click(screen.getByRole('button', { name: /typography/i }))
    fireEvent.change(screen.getByRole('spinbutton', { name: /letter spacing/i }), { target: { value: '2.5' } })

    const updatedCaption = useEditorStore.getState().tracks.find((track) => track.type === 'caption')!.clips[0] as any
    expect(updatedCaption.style.letterSpacing).toBe(2.5)
  })
})
