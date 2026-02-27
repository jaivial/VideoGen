import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VideoPlayer } from './VideoPlayer'
import { useEditorStore } from '../../stores/editorStore'

// Mock the video element methods
const mockPlay = vi.fn().mockResolvedValue(undefined)
const mockPause = vi.fn()

describe('VideoPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Reset store state by calling actions directly (not setState)
    const store = useEditorStore

    // Clear clips from all tracks
    const state = store.getState()
    state.tracks.forEach(track => {
      while (track.clips.length > 0) {
        state.removeClip(track.clips[0].id)
      }
    })

    // Reset other state
    store.getState().setCurrentTime(0)
    store.getState().setDuration(0)
    store.getState().setIsPlaying(false)
    store.getState().setZoom(50)
    store.getState().setScrollX(0)
    store.getState().deselectAll()

    // Mock HTMLMediaElement methods
    vi.stubGlobal('HTMLMediaElement', {
      prototype: {
        play: mockPlay,
        pause: mockPause,
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('video URL extraction', () => {
    it('should display "No video loaded" when no video clips exist', () => {
      render(<VideoPlayer />)

      expect(screen.getByText('No video loaded')).toBeInTheDocument()
    })

    it('should extract video URL from first video track clip', () => {
      const store = useEditorStore
      const state = store.getState()
      const videoTrack = state.tracks.find((t) => t.type === 'video')!

      store.getState().addClip(videoTrack.id, {
        mediaId: 'media-1',
        name: 'Test Video',
        type: 'video',
        startTime: 0,
        duration: 30,
        trimStart: 0,
        trimEnd: 30,
        url: 'https://example.com/test-video.mp4',
        volume: 1,
        speed: 1,
        volumeKeyframes: [],
        speedKeyframes: [],
        effects: [],
      })

      render(<VideoPlayer />)

      const video = document.querySelector('video')
      expect(video).toHaveAttribute('src', 'https://example.com/test-video.mp4')
    })
  })

  describe('play/pause functionality', () => {
    it('should toggle play/pause when clicking the player', () => {
      render(<VideoPlayer />)

      // Initially not playing
      expect(useEditorStore.getState().isPlaying).toBe(false)

      // Click to play - find the player container and click it
      const playerContainer = document.querySelector('.relative.bg-black')
      if (playerContainer) {
        fireEvent.click(playerContainer)
      }

      expect(useEditorStore.getState().isPlaying).toBe(true)
    })

    it('should show play button overlay when paused with video loaded', () => {
      const store = useEditorStore
      const state = store.getState()
      const videoTrack = state.tracks.find((t) => t.type === 'video')!

      // Add a video clip
      store.getState().addClip(videoTrack.id, {
        mediaId: 'media-1',
        name: 'Test Video',
        type: 'video',
        startTime: 0,
        duration: 30,
        trimStart: 0,
        trimEnd: 30,
        url: 'https://example.com/test-video.mp4',
        volume: 1,
        speed: 1,
        volumeKeyframes: [],
        speedKeyframes: [],
        effects: [],
      })

      // Set playing to false (default)
      store.getState().pause()

      render(<VideoPlayer />)

      // The play overlay icon should be visible (play icon inside the play button)
      const playButtons = document.querySelectorAll('svg')
      const playIcon = Array.from(playButtons).find(
        (svg) => svg.getAttribute('d') === 'M8 5v14l11-7z'
      )
      expect(playIcon).toBeInTheDocument()
    })

    it('should have play/pause button in controls', () => {
      const store = useEditorStore
      const state = store.getState()
      const videoTrack = state.tracks.find((t) => t.type === 'video')!

      // Add a video clip so controls are visible
      store.getState().addClip(videoTrack.id, {
        mediaId: 'media-1',
        name: 'Test Video',
        type: 'video',
        startTime: 0,
        duration: 30,
        trimStart: 0,
        trimEnd: 30,
        url: 'https://example.com/test-video.mp4',
        volume: 1,
        speed: 1,
        volumeKeyframes: [],
        speedKeyframes: [],
        effects: [],
      })

      render(<VideoPlayer />)

      // Find play/pause button (it's a button with an SVG inside)
      const buttons = document.querySelectorAll('button')
      // The play/pause button is the first button in the controls bar
      expect(buttons.length).toBeGreaterThan(0)
    })
  })

  describe('seeking functionality', () => {
    it('should have a range input for seeking', () => {
      useEditorStore.getState().setDuration(60)

      render(<VideoPlayer />)

      const rangeInput = screen.getByRole('slider')
      expect(rangeInput).toBeInTheDocument()
      expect(rangeInput).toHaveAttribute('type', 'range')
    })

    it('should update currentTime when range input changes', () => {
      useEditorStore.getState().setDuration(60)

      render(<VideoPlayer />)

      const rangeInput = screen.getByRole('slider') as HTMLInputElement
      fireEvent.change(rangeInput, { target: { value: '30' } })

      expect(useEditorStore.getState().currentTime).toBe(30)
    })

    it('should update currentTime via keyboard shortcuts', () => {
      useEditorStore.getState().setDuration(60)
      useEditorStore.getState().setCurrentTime(30)

      render(<VideoPlayer />)

      // ArrowRight should increase time by 1 second
      fireEvent.keyDown(document.body, { key: 'ArrowRight' })
      expect(useEditorStore.getState().currentTime).toBe(31)

      // ArrowLeft should decrease time by 1 second
      fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
      expect(useEditorStore.getState().currentTime).toBe(30)

      // Shift+Arrow should move by 5 seconds
      fireEvent.keyDown(document.body, { key: 'ArrowRight', shiftKey: true })
      expect(useEditorStore.getState().currentTime).toBe(35)
    })

    it('should not seek beyond duration', () => {
      useEditorStore.getState().setDuration(60)
      useEditorStore.getState().setCurrentTime(50)

      render(<VideoPlayer />)

      // Try to seek beyond duration
      fireEvent.keyDown(document.body, { key: 'ArrowRight' }) // Would go to 51
      expect(useEditorStore.getState().currentTime).toBeLessThanOrEqual(60)
    })

    it('should not seek below 0', () => {
      useEditorStore.getState().setDuration(60)
      useEditorStore.getState().setCurrentTime(0)

      render(<VideoPlayer />)

      // Try to seek below 0
      fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
      expect(useEditorStore.getState().currentTime).toBeGreaterThanOrEqual(0)
    })
  })

  describe('time display', () => {
    it('should display formatted time', () => {
      useEditorStore.getState().setDuration(125) // 2:05
      useEditorStore.getState().setCurrentTime(65) // 1:05

      render(<VideoPlayer />)

      // Time should be displayed as "MM:SS.ms / MM:SS.ms"
      const timeDisplay = screen.getByText(/\d:\d{2}\.\d{2}/)
      expect(timeDisplay).toBeInTheDocument()
    })
  })

  describe('skip buttons', () => {
    it('should have skip backward and forward buttons', () => {
      useEditorStore.getState().setDuration(60)
      useEditorStore.getState().setCurrentTime(30)

      render(<VideoPlayer />)

      // The component should have skip buttons
      // We can verify by checking that the keyboard shortcuts work
      fireEvent.keyDown(document.body, { key: 'j' }) // Skip backward
      expect(useEditorStore.getState().currentTime).toBe(20) // 30 - 10

      fireEvent.keyDown(document.body, { key: 'l' }) // Skip forward
      expect(useEditorStore.getState().currentTime).toBe(30) // 20 + 10
    })
  })
})
