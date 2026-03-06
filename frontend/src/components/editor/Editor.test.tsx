import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from './Editor'
import { useEditorStore } from '../../stores/editorStore'

describe('Editor preview workspace', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(vi.fn().mockResolvedValue(undefined) as any)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(vi.fn() as any)

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
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders the preview inside a dedicated fixed workspace area', () => {
    render(<Editor />)

    expect(screen.getByTestId('preview-workspace')).toBeInTheDocument()
  })

  it('places hidden-sidebar restore actions inside the toolbar instead of over the preview', () => {
    render(<Editor />)

    fireEvent.click(screen.getByTitle('Hide media library'))
    fireEvent.click(screen.getByTitle('Hide properties'))

    const toolbar = screen.getByTestId('editor-toolbar')
    expect(toolbar).toContainElement(screen.getByTitle('Show media library'))
    expect(toolbar).toContainElement(screen.getByTitle('Show properties'))
  })
})
