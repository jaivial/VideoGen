import { describe, it, expect, beforeEach } from 'vitest'
import { useEditorStore } from './editorStore'
import type { VideoClip } from '../types/editor'

describe('editorStore', () => {
  // Helper to reset store to a clean state
  const resetStore = () => {
    const state = useEditorStore.getState()
    // Reset by reloading - but for testing we can just use the actions
    // to set things back to known state
    state.setCurrentTime(0)
    state.setDuration(0)
    state.setZoom(50)
    state.setScrollX(0)
    state.deselectAll()
    state.selectTrack(null)
  }

  beforeEach(() => {
    // Get current state and reset it
    const state = useEditorStore.getState()

    // Clear all tracks clips
    state.tracks.forEach(track => {
      while (track.clips.length > 0) {
        const clipId = track.clips[0].id
        state.removeClip(clipId)
      }
    })

    // Reset state values
    state.setCurrentTime(0)
    state.setDuration(0)
    state.setIsPlaying(false)
    state.setZoom(50)
    state.setScrollX(0)
    state.deselectAll()
    state.selectTrack(null)
  })

  describe('initializeFromVideo', () => {
    it('should create a video clip from a video URL and set duration', () => {
      const videoUrl = 'https://example.com/video.mp4'
      const duration = 120 // 2 minutes

      useEditorStore.getState().initializeFromVideo(videoUrl, duration)

      const state = useEditorStore.getState()
      const videoTrack = state.tracks.find((t) => t.type === 'video')

      expect(videoTrack).toBeDefined()
      expect(videoTrack!.clips).toHaveLength(1)
      expect(videoTrack!.clips[0].type).toBe('video')
      expect((videoTrack!.clips[0] as VideoClip).url).toBe(videoUrl)
      expect(videoTrack!.clips[0].duration).toBe(duration)
      expect(videoTrack!.clips[0].startTime).toBe(0)
      expect(state.duration).toBe(duration)
      expect(state.project.name).toBe('Imported Video')
    })

    it('should handle multiple initializeFromVideo calls', () => {
      const videoUrl1 = 'https://example.com/video1.mp4'
      const duration1 = 60

      useEditorStore.getState().initializeFromVideo(videoUrl1, duration1)

      const videoUrl2 = 'https://example.com/video2.mp4'
      const duration2 = 90

      useEditorStore.getState().initializeFromVideo(videoUrl2, duration2)

      const state = useEditorStore.getState()
      const videoTrack = state.tracks.find((t) => t.type === 'video')

      // Should have 2 clips now
      expect(videoTrack!.clips).toHaveLength(2)
    })
  })

  describe('addClip', () => {
    it('should add a clip to a specific track', () => {
      const state = useEditorStore.getState()
      const videoTrack = state.tracks.find((t) => t.type === 'video')!

      const newClip: Omit<VideoClip, 'id' | 'trackId'> = {
        mediaId: 'media-1',
        name: 'Test Clip',
        type: 'video',
        startTime: 0,
        duration: 10,
        trimStart: 0,
        trimEnd: 10,
        url: 'https://example.com/clip.mp4',
        volume: 1,
        speed: 1,
        volumeKeyframes: [],
        speedKeyframes: [],
        effects: [],
      }

      useEditorStore.getState().addClip(videoTrack.id, newClip)

      const updatedState = useEditorStore.getState()
      const updatedTrack = updatedState.tracks.find((t) => t.type === 'video')!

      expect(updatedTrack.clips).toHaveLength(1)
      expect(updatedTrack.clips[0].name).toBe('Test Clip')
      expect(updatedTrack.clips[0].duration).toBe(10)
      expect(updatedState.duration).toBe(10)
    })

    it('should update duration when clip extends beyond current duration', () => {
      const state = useEditorStore.getState()
      const videoTrack = state.tracks.find((t) => t.type === 'video')!

      // Add first clip
      useEditorStore.getState().addClip(videoTrack.id, {
        mediaId: 'media-1',
        name: 'Clip 1',
        type: 'video',
        startTime: 0,
        duration: 10,
        trimStart: 0,
        trimEnd: 10,
        url: 'https://example.com/clip.mp4',
        volume: 1,
        speed: 1,
        volumeKeyframes: [],
        speedKeyframes: [],
        effects: [],
      })

      // Add second clip starting after first
      useEditorStore.getState().addClip(videoTrack.id, {
        mediaId: 'media-2',
        name: 'Clip 2',
        type: 'video',
        startTime: 15,
        duration: 20,
        trimStart: 0,
        trimEnd: 20,
        url: 'https://example.com/clip2.mp4',
        volume: 1,
        speed: 1,
        volumeKeyframes: [],
        speedKeyframes: [],
        effects: [],
      })

      const updatedState = useEditorStore.getState()
      expect(updatedState.duration).toBe(35) // 15 + 20
    })

    it('should not add clip to non-existent track', () => {
      const nonExistentTrackId = 'non-existent-id'

      expect(() => {
        useEditorStore.getState().addClip(nonExistentTrackId, {
          mediaId: 'media-1',
          name: 'Test Clip',
          type: 'video',
          startTime: 0,
          duration: 10,
          trimStart: 0,
          trimEnd: 10,
          url: 'https://example.com/clip.mp4',
          volume: 1,
          speed: 1,
          volumeKeyframes: [],
          speedKeyframes: [],
          effects: [],
        })
      }).not.toThrow()
    })
  })

  describe('removeClip', () => {
    it('should remove a clip from a track', () => {
      const state = useEditorStore.getState()
      const videoTrack = state.tracks.find((t) => t.type === 'video')!

      // Add a clip first
      useEditorStore.getState().addClip(videoTrack.id, {
        mediaId: 'media-1',
        name: 'Test Clip',
        type: 'video',
        startTime: 0,
        duration: 10,
        trimStart: 0,
        trimEnd: 10,
        url: 'https://example.com/clip.mp4',
        volume: 1,
        speed: 1,
        volumeKeyframes: [],
        speedKeyframes: [],
        effects: [],
      })

      const stateAfterAdd = useEditorStore.getState()
      const clipId = stateAfterAdd.tracks
        .find((t) => t.type === 'video')!
        .clips[0].id

      // Remove the clip
      useEditorStore.getState().removeClip(clipId)

      const updatedState = useEditorStore.getState()
      const updatedTrack = updatedState.tracks.find((t) => t.type === 'video')!

      expect(updatedTrack.clips).toHaveLength(0)
    })

    it('should deselect removed clip if selected', () => {
      const state = useEditorStore.getState()
      const videoTrack = state.tracks.find((t) => t.type === 'video')!

      // Add a clip
      useEditorStore.getState().addClip(videoTrack.id, {
        mediaId: 'media-1',
        name: 'Test Clip',
        type: 'video',
        startTime: 0,
        duration: 10,
        trimStart: 0,
        trimEnd: 10,
        url: 'https://example.com/clip.mp4',
        volume: 1,
        speed: 1,
        volumeKeyframes: [],
        speedKeyframes: [],
        effects: [],
      })

      const stateAfterAdd = useEditorStore.getState()
      const clipId = stateAfterAdd.tracks
        .find((t) => t.type === 'video')!
        .clips[0].id

      // Select the clip
      useEditorStore.getState().selectClip(clipId)
      expect(useEditorStore.getState().selectedClipIds).toContain(clipId)

      // Remove the clip
      useEditorStore.getState().removeClip(clipId)

      expect(useEditorStore.getState().selectedClipIds).not.toContain(clipId)
    })
  })

  describe('track selection', () => {
    it('should select a track', () => {
      const state = useEditorStore.getState()
      const audioTrack = state.tracks.find((t) => t.type === 'audio')!

      useEditorStore.getState().selectTrack(audioTrack.id)

      expect(useEditorStore.getState().selectedTrackId).toBe(audioTrack.id)
    })

    it('should deselect track when null is passed', () => {
      const state = useEditorStore.getState()
      const audioTrack = state.tracks.find((t) => t.type === 'audio')!

      useEditorStore.getState().selectTrack(audioTrack.id)
      expect(useEditorStore.getState().selectedTrackId).toBe(audioTrack.id)

      useEditorStore.getState().selectTrack(null)
      expect(useEditorStore.getState().selectedTrackId).toBeNull()
    })
  })

  describe('clip selection', () => {
    it('should select a single clip', () => {
      const state = useEditorStore.getState()
      const videoTrack = state.tracks.find((t) => t.type === 'video')!

      // Add clips
      useEditorStore.getState().addClip(videoTrack.id, {
        mediaId: 'media-1',
        name: 'Clip 1',
        type: 'video',
        startTime: 0,
        duration: 10,
        trimStart: 0,
        trimEnd: 10,
        url: 'https://example.com/clip.mp4',
        volume: 1,
        speed: 1,
        volumeKeyframes: [],
        speedKeyframes: [],
        effects: [],
      })

      const clipId = useEditorStore.getState().tracks
        .find((t) => t.type === 'video')!
        .clips[0].id

      useEditorStore.getState().selectClip(clipId)

      expect(useEditorStore.getState().selectedClipIds).toContain(clipId)
      expect(useEditorStore.getState().selectedClipIds).toHaveLength(1)
    })

    it('should support multi-select with multi parameter', () => {
      const state = useEditorStore.getState()
      const videoTrack = state.tracks.find((t) => t.type === 'video')!

      // Add two clips
      useEditorStore.getState().addClip(videoTrack.id, {
        mediaId: 'media-1',
        name: 'Clip 1',
        type: 'video',
        startTime: 0,
        duration: 10,
        trimStart: 0,
        trimEnd: 10,
        url: 'https://example.com/clip.mp4',
        volume: 1,
        speed: 1,
        volumeKeyframes: [],
        speedKeyframes: [],
        effects: [],
      })

      useEditorStore.getState().addClip(videoTrack.id, {
        mediaId: 'media-2',
        name: 'Clip 2',
        type: 'video',
        startTime: 10,
        duration: 10,
        trimStart: 0,
        trimEnd: 10,
        url: 'https://example.com/clip2.mp4',
        volume: 1,
        speed: 1,
        volumeKeyframes: [],
        speedKeyframes: [],
        effects: [],
      })

      const tracks = useEditorStore.getState().tracks
      const clip1Id = tracks.find((t) => t.type === 'video')!.clips[0].id
      const clip2Id = tracks.find((t) => t.type === 'video')!.clips[1].id

      useEditorStore.getState().selectClip(clip1Id)
      useEditorStore.getState().selectClip(clip2Id, true) // multi-select

      const selectedIds = useEditorStore.getState().selectedClipIds
      expect(selectedIds).toHaveLength(2)
      expect(selectedIds).toContain(clip1Id)
      expect(selectedIds).toContain(clip2Id)
    })

    it('should deselect all clips', () => {
      const state = useEditorStore.getState()
      const videoTrack = state.tracks.find((t) => t.type === 'video')!

      useEditorStore.getState().addClip(videoTrack.id, {
        mediaId: 'media-1',
        name: 'Clip 1',
        type: 'video',
        startTime: 0,
        duration: 10,
        trimStart: 0,
        trimEnd: 10,
        url: 'https://example.com/clip.mp4',
        volume: 1,
        speed: 1,
        volumeKeyframes: [],
        speedKeyframes: [],
        effects: [],
      })

      const clipId = useEditorStore.getState().tracks
        .find((t) => t.type === 'video')!
        .clips[0].id

      useEditorStore.getState().selectClip(clipId)
      expect(useEditorStore.getState().selectedClipIds).toHaveLength(1)

      useEditorStore.getState().deselectAll()
      expect(useEditorStore.getState().selectedClipIds).toHaveLength(0)
    })
  })

  describe('currentTime and duration', () => {
    it('should update currentTime', () => {
      useEditorStore.getState().setCurrentTime(10)

      expect(useEditorStore.getState().currentTime).toBe(10)
    })

    it('should clamp currentTime to valid range', () => {
      // Set duration first
      useEditorStore.getState().setDuration(100)

      // Test clamping above duration
      useEditorStore.getState().setCurrentTime(150)
      expect(useEditorStore.getState().currentTime).toBe(100)

      // Test clamping below 0
      useEditorStore.getState().setCurrentTime(-10)
      expect(useEditorStore.getState().currentTime).toBe(0)
    })

    it('should update duration', () => {
      useEditorStore.getState().setDuration(60)

      expect(useEditorStore.getState().duration).toBe(60)
      expect(useEditorStore.getState().project.duration).toBe(60)
    })

    it('should play and pause', () => {
      expect(useEditorStore.getState().isPlaying).toBe(false)

      useEditorStore.getState().play()
      expect(useEditorStore.getState().isPlaying).toBe(true)

      useEditorStore.getState().pause()
      expect(useEditorStore.getState().isPlaying).toBe(false)
    })

    it('should toggle play/pause', () => {
      expect(useEditorStore.getState().isPlaying).toBe(false)

      useEditorStore.getState().togglePlayPause()
      expect(useEditorStore.getState().isPlaying).toBe(true)

      useEditorStore.getState().togglePlayPause()
      expect(useEditorStore.getState().isPlaying).toBe(false)
    })
  })

  describe('zoom', () => {
    it('should set zoom level', () => {
      useEditorStore.getState().setZoom(100)

      expect(useEditorStore.getState().zoom).toBe(100)
    })

    it('should clamp zoom to valid range (10-200)', () => {
      useEditorStore.getState().setZoom(5)
      expect(useEditorStore.getState().zoom).toBe(10)

      useEditorStore.getState().setZoom(300)
      expect(useEditorStore.getState().zoom).toBe(200)
    })
  })

  describe('scrollX', () => {
    it('should set scrollX', () => {
      useEditorStore.getState().setScrollX(100)

      expect(useEditorStore.getState().scrollX).toBe(100)
    })

    it('should not allow negative scrollX', () => {
      useEditorStore.getState().setScrollX(-50)

      expect(useEditorStore.getState().scrollX).toBe(0)
    })
  })
})
