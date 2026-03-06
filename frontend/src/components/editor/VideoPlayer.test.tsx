import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { VideoPlayer } from './VideoPlayer'
import { useEditorStore } from '../../stores/editorStore'

// Mock the video element methods
const mockPlay = vi.fn().mockResolvedValue(undefined)
const mockPause = vi.fn()

describe('VideoPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Clear clips from all tracks (must re-read state; immer updates create new objects)
    while (true) {
      const state = useEditorStore.getState()
      const trackWithClip = state.tracks.find((t) => t.clips.length > 0)
      if (!trackWithClip) break
      state.removeClip(trackWithClip.clips[0].id)
    }

    // Reset other state
    useEditorStore.getState().setCurrentTime(0)
    useEditorStore.getState().setDuration(0)
    useEditorStore.getState().setIsPlaying(false)
    useEditorStore.getState().setZoom(50)
    useEditorStore.getState().setScrollX(0)
    useEditorStore.getState().deselectAll()

    // Mock HTMLMediaElement methods (jsdom doesn't implement play/pause)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(mockPlay as any)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(mockPause as any)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  describe('video URL extraction', () => {
    it('should display "No video loaded" when no video clips exist', () => {
      render(<VideoPlayer />)

      expect(screen.getByText('No video loaded')).toBeInTheDocument()
    })

    it('uses the project composition aspect ratio when no media is loaded', () => {
      useEditorStore.getState().setProjectResolution({ width: 1080, height: 1920, label: 'Portrait' })

      render(<VideoPlayer />)

      const player = document.querySelector('.relative.bg-black.rounded-lg') as HTMLDivElement | null
      expect(player).toBeInTheDocument()
      expect(player?.style.aspectRatio).toBe('0.5625')
    })

    it('applies richer caption styling in the preview overlay', () => {
      useEditorStore.getState().setDuration(5)
      useEditorStore.getState().addCaption(0, 4, 'Styled caption')

      const captionTrack = useEditorStore.getState().tracks.find((track) => track.type === 'caption')!
      const caption = captionTrack.clips[0] as any
      useEditorStore.getState().updateClip(caption.id, {
        style: {
          ...caption.style,
          italic: true,
          underline: true,
          textTransform: 'uppercase',
          letterSpacing: 2.5,
          maxWidthPercent: 62,
          paddingX: 32,
          paddingY: 16,
          backgroundOpacity: 0.5,
        },
      } as any)

      render(<VideoPlayer />)

      const captionNode = screen.getByText('STYLED CAPTION')
      expect(captionNode).toHaveStyle({
        fontStyle: 'italic',
        textDecoration: 'underline',
        textTransform: 'uppercase',
        letterSpacing: '2.5px',
        maxWidth: '62%',
        padding: '16px 32px',
      })
    })

    it('renders typewriter motion progressively in the preview', () => {
      useEditorStore.getState().setDuration(5)
      useEditorStore.getState().addCaption(0, 4, 'Animated caption')

      const captionTrack = useEditorStore.getState().tracks.find((track) => track.type === 'caption')!
      const caption = captionTrack.clips[0] as any
      useEditorStore.getState().updateClip(caption.id, {
        style: {
          ...caption.style,
          animation: 'typewriter',
          animationDuration: 2,
        },
      } as any)
      useEditorStore.getState().setCurrentTime(1)

      render(<VideoPlayer />)

      expect(screen.queryByText('Animated caption')).not.toBeInTheDocument()
      expect(screen.getByText('Animated')).toBeInTheDocument()
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
      const store = useEditorStore
      const state = store.getState()
      const videoTrack = state.tracks.find((t) => t.type === 'video')!

      // Add a video clip so playback can start
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

      // Overlay uses the larger play icon (w-8 h-8). Controls use w-4 h-4.
      expect(document.querySelector('svg.w-8.h-8')).toBeInTheDocument()
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
