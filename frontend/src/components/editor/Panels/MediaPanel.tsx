import { useState, useCallback } from 'react'
import { useEditorStore } from '../../../stores/editorStore'
import type { MediaItem, VideoClip } from '../../../types/editor'

// Helper to get full media metadata including width, height, fps
async function getFullMediaMetadata(url: string, type: 'video' | 'image' | 'audio'): Promise<{
  duration: number
  width?: number
  height?: number
  fps?: number
  thumbnailUrl?: string
}> {
  return new Promise((resolve) => {
    if (type === 'audio') {
      const audio = document.createElement('audio')
      audio.preload = 'metadata'
      audio.onloadedmetadata = () => {
        resolve({
          duration: audio.duration || 5,
          width: undefined,
          height: undefined,
          fps: undefined,
          thumbnailUrl: undefined,
        })
        URL.revokeObjectURL(url)
      }
      audio.onerror = () => {
        resolve({ duration: 5 })
        URL.revokeObjectURL(url)
      }
      audio.src = url
      return
    }

    const element = document.createElement(type)
    element.preload = 'metadata'

    element.onloadedmetadata = async () => {
      const width = (element as HTMLVideoElement).videoWidth
      const height = (element as HTMLVideoElement).videoHeight
      const duration = element.duration || 5

      // Generate thumbnail for video
      let thumbnailUrl: string | undefined
      if (type === 'video' && width && height) {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const ctx = canvas.getContext('2d')
          if (ctx) {
            element.currentTime = 0
            await new Promise<void>((res) => {
              element.onseeked = () => {
                ctx.drawImage(element, 0, 0, width, height)
                thumbnailUrl = canvas.toDataURL('image/jpeg', 0.8)
                res()
              }
            })
          }
        } catch (e) {
          // Thumbnail generation failed
        }
      }

      resolve({
        duration,
        width: type === 'video' || type === 'image' ? width : undefined,
        height: type === 'video' || type === 'image' ? height : undefined,
        fps: type === 'video' ? 30 : undefined, // Default fps, could be detected
        thumbnailUrl,
      })
      URL.revokeObjectURL(url)
    }

    element.onerror = () => {
      resolve({ duration: 5 })
      URL.revokeObjectURL(url)
    }
    element.src = url
  })
}

export function MediaPanel() {
  const { media, addMedia, removeMedia, addClip, tracks, project } = useEditorStore()
  const [isUploading, setIsUploading] = useState(false)

  const handleFileUpload = useCallback(async (files: FileList) => {
    setIsUploading(true)

    for (const file of Array.from(files)) {
      // Determine media type
      let type: 'video' | 'image' | 'audio'
      if (file.type.startsWith('video/')) {
        type = 'video'
      } else if (file.type.startsWith('image/')) {
        type = 'image'
      } else if (file.type.startsWith('audio/')) {
        type = 'audio'
      } else {
        continue
      }

      // Create object URL for preview
      const url = URL.createObjectURL(file)

      // Get full metadata for video/image/audio
      const metadata = await getFullMediaMetadata(url, type)

      // Add to media library with full metadata
      addMedia({
        name: file.name,
        type,
        url,
        duration: metadata.duration,
        width: metadata.width,
        height: metadata.height,
        fps: metadata.fps,
        thumbnailUrl: metadata.thumbnailUrl,
      })
    }

    setIsUploading(false)
  }, [addMedia])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files)
    }
  }, [handleFileUpload])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleAddToTimeline = useCallback((mediaItem: MediaItem) => {
    // Find appropriate track
    const track = tracks.find((t) => t.type === mediaItem.type)
    if (!track) {
      console.error('No track found for media type:', mediaItem.type)
      return
    }

    // Get current playhead time
    const currentTime = useEditorStore.getState().currentTime

    // Add clip to track with original media metadata
    const clipData: any = {
      mediaId: mediaItem.id,
      name: mediaItem.name,
      type: mediaItem.type,
      startTime: currentTime,
      duration: mediaItem.duration,
      trimStart: 0,
      trimEnd: mediaItem.duration,
      url: mediaItem.url,
      thumbnailUrl: mediaItem.thumbnailUrl,
      volume: 1,
      speed: 1,
      volumeKeyframes: [],
      speedKeyframes: [],
      effects: [],
    }

    // Include original media properties for video/image
    if (mediaItem.type === 'video' || mediaItem.type === 'image') {
      clipData.originalWidth = mediaItem.width
      clipData.originalHeight = mediaItem.height
      clipData.originalDuration = mediaItem.duration
      clipData.originalFps = mediaItem.fps
    }

    addClip(track.id, clipData)
  }, [tracks, addClip])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700">
        <h3 className="text-sm font-semibold text-white">Media Library</h3>
      </div>

      {/* Upload area */}
      <div
        className="m-4 p-6 border-2 border-dashed border-gray-600 rounded-lg text-center hover:border-blue-500 transition-colors cursor-pointer"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => document.getElementById('media-upload-input')?.click()}
      >
        <input
          id="media-upload-input"
          type="file"
          multiple
          accept="video/*,image/*,audio/*"
          className="hidden"
          onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
        />
        {isUploading ? (
          <div className="flex items-center justify-center">
            <svg className="animate-spin h-6 w-6 text-blue-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span className="ml-2 text-gray-400">Uploading...</span>
          </div>
        ) : (
          <>
            <svg className="w-8 h-8 mx-auto text-gray-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-sm text-gray-400">Drop files here or click to upload</p>
            <p className="text-xs text-gray-500 mt-1">Video, Image, Audio</p>
          </>
        )}
      </div>

      {/* Media grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {media.length === 0 ? (
          <div className="text-center text-gray-500 text-sm py-8">
            No media files yet
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {media.map((item) => (
              <MediaThumbnail
                key={item.id}
                item={item}
                onAdd={() => handleAddToTimeline(item)}
                onDelete={() => removeMedia(item.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface MediaThumbnailProps {
  item: MediaItem
  onAdd: () => void
  onDelete: () => void
}

function MediaThumbnail({ item, onAdd, onDelete }: MediaThumbnailProps) {
  const [showActions, setShowActions] = useState(false)

  // Format duration
  const formatDuration = (seconds: number) => {
    if (seconds >= 60) {
      const mins = Math.floor(seconds / 60)
      const secs = Math.floor(seconds % 60)
      return `${mins}:${secs.toString().padStart(2, '0')}`
    }
    return `${seconds.toFixed(1)}s`
  }

  // Format resolution
  const formatResolution = () => {
    if (item.width && item.height) {
      return `${item.width}x${item.height}`
    }
    return null
  }

  return (
    <div
      className="relative group rounded-lg overflow-hidden bg-gray-800"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Preview */}
      {item.type === 'video' && item.thumbnailUrl && (
        <div
          className="aspect-video bg-gray-900 bg-cover bg-center"
          style={{ backgroundImage: `url(${item.thumbnailUrl})` }}
        />
      )}
      {item.type === 'video' && !item.thumbnailUrl && (
        <div className="aspect-video bg-gray-900 flex items-center justify-center">
          <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>
      )}
      {item.type === 'image' && (
        <div
          className="aspect-video bg-gray-900 bg-cover bg-center"
          style={{ backgroundImage: `url(${item.url})` }}
        />
      )}
      {item.type === 'audio' && (
        <div className="aspect-video bg-gray-900 flex items-center justify-center">
          <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
        </div>
      )}

      {/* Info */}
      <div className="p-2">
        <p className="text-xs text-gray-300 truncate">{item.name}</p>
        <div className="flex items-center gap-1 text-[10px] text-gray-500">
          <span>{formatDuration(item.duration)}</span>
          {formatResolution() && (
            <>
              <span className="text-gray-600">|</span>
              <span>{formatResolution()}</span>
            </>
          )}
          {item.fps && (
            <>
              <span className="text-gray-600">|</span>
              <span>{item.fps}fps</span>
            </>
          )}
        </div>
      </div>

      {/* Hover actions */}
      <div
        className={`absolute inset-0 bg-black/60 flex items-center justify-center gap-2 transition-opacity ${
          showActions ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <button
          onClick={onAdd}
          className="p-2 bg-blue-600 rounded-full hover:bg-blue-500 transition-colors"
          title="Add to timeline"
        >
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </button>
        <button
          onClick={onDelete}
          className="p-2 bg-red-600 rounded-full hover:bg-red-500 transition-colors"
          title="Delete"
        >
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  )
}
