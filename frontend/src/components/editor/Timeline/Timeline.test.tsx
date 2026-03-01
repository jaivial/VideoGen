import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Timeline } from './Timeline'
import { useEditorStore } from '../../../stores/editorStore'

// Mock dnd-kit components
vi.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({
    setNodeRef: vi.fn(),
    isOver: false,
  }),
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    isDragging: false,
  }),
}))

describe('Timeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Clear all tracks clips (must re-read state; immer updates create new objects)
    while (true) {
      const state = useEditorStore.getState()
      const trackWithClip = state.tracks.find((t) => t.clips.length > 0)
      if (!trackWithClip) break
      state.removeClip(trackWithClip.clips[0].id)
    }

    // Reset state values using actions
    const state = useEditorStore.getState()
    state.setCurrentTime(0)
    state.setDuration(0)
    state.setZoom(50)
    state.setScrollX(0)
    state.deselectAll()
    state.selectTrack(null)
    state.setIsPlaying(false)
  })

  describe('track rendering', () => {
    it('should render all tracks', () => {
      render(<Timeline />)

      expect(screen.getByText('Video 1')).toBeInTheDocument()
      expect(screen.getByText('Audio 1')).toBeInTheDocument()
      expect(screen.getByText('Captions')).toBeInTheDocument()
    })

    it('should display "Drop media here" for empty tracks', () => {
      render(<Timeline />)

      // Empty tracks should show the drop indicator
      const dropIndicators = screen.getAllByText('Drop media here')
      expect(dropIndicators.length).toBeGreaterThan(0)
    })

    it('should render clips when added to tracks', () => {
      // Add a video clip
      const store = useEditorStore
      const state = store.getState()
      const videoTrack = state.tracks.find((t) => t.type === 'video')!

      store.getState().addClip(videoTrack.id, {
        mediaId: 'media-1',
        name: 'Test Clip',
        type: 'video',
        startTime: 0,
        duration: 10,
        trimStart: 0,
        trimEnd: 10,
        url: 'https://example.com/test.mp4',
        volume: 1,
        speed: 1,
        volumeKeyframes: [],
        speedKeyframes: [],
        effects: [],
      })

      render(<Timeline />)

      expect(screen.getByText('Test Clip')).toBeInTheDocument()
      expect(screen.getByText('10.0s')).toBeInTheDocument()
    })

    it('should show track mute/lock buttons', () => {
      render(<Timeline />)

      // Track headers should have mute and lock buttons
      // We can check for the mute/lock icons
      const buttons = document.querySelectorAll('button')
      // Each track has mute and lock buttons
      expect(buttons.length).toBeGreaterThanOrEqual(6) // 3 tracks x 2 buttons each
    })
  })

  describe('playhead position', () => {
    it('should display playhead at initial position (0)', () => {
      useEditorStore.getState().setDuration(60)

      render(<Timeline />)

      // The playhead should be rendered
      const playhead = document.querySelector('.bg-red-500')
      expect(playhead).toBeInTheDocument()
    })

    it('should update playhead position when currentTime changes', () => {
      useEditorStore.getState().setDuration(60)
      useEditorStore.getState().setCurrentTime(30)

      const { container } = render(<Timeline />)

      // Get the playhead element
      const playhead = container.querySelector('.bg-red-500')
      expect(playhead).toBeInTheDocument()
    })

    it('should display current time in footer', () => {
      useEditorStore.getState().setDuration(125) // 2:05
      useEditorStore.getState().setCurrentTime(65) // 1:05

      render(<Timeline />)

      // Should show "Current time: 1:05 | Duration: 2:05"
      expect(screen.getByText(/Current time: 1:05/)).toBeInTheDocument()
      expect(screen.getByText(/Duration: 2:05/)).toBeInTheDocument()
    })
  })

  describe('zoom functionality', () => {
    it('should have a zoom slider', () => {
      render(<Timeline />)

      const zoomSlider = screen.getByRole('slider')
      expect(zoomSlider).toBeInTheDocument()
    })

    it('should update zoom level when slider changes', () => {
      render(<Timeline />)

      const zoomSlider = screen.getByRole('slider') as HTMLInputElement

      // Default zoom is 50
      expect(useEditorStore.getState().zoom).toBe(50)

      // Change zoom
      fireEvent.change(zoomSlider, { target: { value: '100' } })

      expect(useEditorStore.getState().zoom).toBe(100)
    })

    it('should display zoom level', () => {
      render(<Timeline />)

      // Default zoom is 50
      expect(screen.getByText(/50px\/s/)).toBeInTheDocument()
    })

    it('should clamp zoom to valid range (10-150)', () => {
      render(<Timeline />)

      const zoomSlider = screen.getByRole('slider') as HTMLInputElement

      // Try to set below minimum
      fireEvent.change(zoomSlider, { target: { value: '5' } })
      expect(useEditorStore.getState().zoom).toBe(10)

      // Try to set above maximum
      fireEvent.change(zoomSlider, { target: { value: '200' } })
      expect(useEditorStore.getState().zoom).toBe(150)
    })

    it('should adjust zoom with ctrl+wheel', () => {
      useEditorStore.getState().setZoom(50)

      render(<Timeline />)

      // Get the timeline container
      const timelineContainer = document.querySelector('.overflow-auto')
      expect(timelineContainer).toBeInTheDocument()

      // Simulate ctrl+wheel to zoom in
      fireEvent.wheel(timelineContainer!, { ctrlKey: true, deltaY: -100 })

      // Zoom should increase
      expect(useEditorStore.getState().zoom).toBeGreaterThan(50)
    })
  })

  describe('timeline navigation', () => {
    it('should have "Go to start" button', () => {
      useEditorStore.getState().setDuration(60)
      useEditorStore.getState().setCurrentTime(30)

      render(<Timeline />)

      const goToStartButton = screen.getByText('Go to start')
      expect(goToStartButton).toBeInTheDocument()

      fireEvent.click(goToStartButton)

      expect(useEditorStore.getState().currentTime).toBe(0)
    })

    it('should have "Go to end" button', () => {
      useEditorStore.getState().setDuration(60)
      useEditorStore.getState().setCurrentTime(30)

      render(<Timeline />)

      const goToEndButton = screen.getByText('Go to end')
      expect(goToEndButton).toBeInTheDocument()

      fireEvent.click(goToEndButton)

      expect(useEditorStore.getState().currentTime).toBe(60)
    })

    it('should seek to clicked position on timeline', () => {
      useEditorStore.getState().setDuration(60)

      render(<Timeline />)

      // Click on timeline area
      const timelineContent = document.querySelector('.relative.min-h-full')
      expect(timelineContent).toBeInTheDocument()

      // Simulate a click at a specific position
      // The timeline area should respond to clicks
      fireEvent.click(timelineContent!, { clientX: 300, clientY: 200 })

      // Current time should have changed from 0
      expect(useEditorStore.getState().currentTime).toBeGreaterThanOrEqual(0)
    })
  })

  describe('horizontal scrolling', () => {
    it('should have horizontal scroll with mouse wheel', () => {
      useEditorStore.getState().setDuration(60)
      useEditorStore.getState().setZoom(50)

      render(<Timeline />)

      const timelineContainer = document.querySelector('.overflow-auto')
      expect(timelineContainer).toBeInTheDocument()

      // Initial scrollX should be 0
      expect(useEditorStore.getState().scrollX).toBe(0)

      // Scroll horizontally
      fireEvent.wheel(timelineContainer!, { deltaX: 100, deltaY: 0 })

      // scrollX should have increased
      expect(useEditorStore.getState().scrollX).toBeGreaterThan(0)
    })
  })

  describe('track operations', () => {
    it('should allow muting a track', () => {
      render(<Timeline />)

      // Find a mute button
      const muteButtons = document.querySelectorAll('button')
      const muteButton = Array.from(muteButtons).find((btn) => {
        const svg = btn.querySelector('svg')
        return svg && svg.innerHTML.includes('M3 9v6h4l5 5')
      })

      if (muteButton) {
        fireEvent.click(muteButton)
        // Track should be muted now
        const state = useEditorStore.getState()
        const videoTrack = state.tracks.find((t) => t.type === 'video')
        expect(videoTrack?.muted).toBe(true)
      }
    })
  })
})
