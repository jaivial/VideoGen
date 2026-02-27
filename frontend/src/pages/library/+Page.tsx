import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, connectWebSocket } from '../../api'

interface Video {
  id: number
  phase_of_generation: string
  output_language: string
  downloaded: boolean
  created_at: string
  error_message?: string | { String: string; Valid: boolean }
}

interface VideoStatus {
  id: number
  phase_of_generation: string
  progress: number
  download_url?: string
  downloaded?: boolean
  download_expires_at?: string
  error?: string
}

type TabType = 'all' | 'processing' | 'completed' | 'errors'

export default function Library() {
  const navigate = useNavigate()
  const [videos, setVideos] = useState<Video[]>([])
  const [currentTab, setCurrentTab] = useState<TabType>('all')
  const [darkMode, setDarkMode] = useState(false)
  const [previewVideo, setPreviewVideo] = useState<{id: number; url: string; expiresAt?: string} | null>(null)
  const [loading, setLoading] = useState(true)

  // Theme colors
  const colors = darkMode ? {
    bg: '#21180d',
    card: '#2d2215',
    text: '#f1f7e1',
    textSecondary: '#bbb098',
    primary: '#c06642',
    primaryHover: '#d9774f',
    border: '#4a3a2a',
    accent: '#c06642',
    success: '#6b9a5b',
    error: '#d9534f',
    warning: '#e6a23c',
  } : {
    bg: '#fffdff',
    card: '#ffffff',
    text: '#1a1a1a',
    textSecondary: '#666666',
    primary: '#004778',
    primaryHover: '#006099',
    border: '#e5e5e5',
    accent: '#f19bbf',
    success: '#4a9c5d',
    error: '#dc3545',
    warning: '#f0ad4e',
  }

  useEffect(() => {
    // Check dark mode preference
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    setDarkMode(prefersDark)
    document.documentElement.classList.toggle('dark', prefersDark)

    // Check auth
    api.me()
      .catch(() => navigate('/login'))

    // Load videos
    loadVideos()
  }, [])

  const loadVideos = async () => {
    try {
      setLoading(true)
      const list = await api.listVideos()
      setVideos(list)
    } catch (err) {
      console.error('Failed to load videos:', err)
    } finally {
      setLoading(false)
    }
  }

  const filteredVideos = videos.filter(video => {
    if (currentTab === 'all') return true
    if (currentTab === 'processing') return !['completed', 'error'].includes(video.phase_of_generation)
    if (currentTab === 'completed') return video.phase_of_generation === 'completed'
    if (currentTab === 'errors') return video.phase_of_generation === 'error'
    return true
  })

  const handleDownload = async (videoId: number) => {
    try {
      const s = await api.getVideoStatus(String(videoId))
      if (s.download_url) {
        // Use fetch + blob approach for proper download
        const response = await fetch(s.download_url)
        const blob = await response.blob()
        const objectUrl = window.URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = objectUrl
        link.download = `video-${videoId}.mp4`
        link.click()
        window.URL.revokeObjectURL(objectUrl)

        // Mark as downloaded
        await api.markDownloaded(String(videoId))
        loadVideos()
      }
    } catch (err) {
      console.error('Failed to download:', err)
    }
  }

  const handlePreview = async (videoId: number) => {
    try {
      const s = await api.getVideoStatus(String(videoId))
      if (s.download_url) {
        setPreviewVideo({
          id: videoId,
          url: s.download_url,
          expiresAt: s.download_expires_at
        })
      }
    } catch (err) {
      console.error('Failed to get preview URL:', err)
    }
  }

  const tabs = [
    { id: 'all' as TabType, label: 'All', count: videos.length },
    { id: 'processing' as TabType, label: 'Processing', count: videos.filter(v => !['completed', 'error'].includes(v.phase_of_generation)).length },
    { id: 'completed' as TabType, label: 'Completed', count: videos.filter(v => v.phase_of_generation === 'completed').length },
    { id: 'errors' as TabType, label: 'Errors', count: videos.filter(v => v.phase_of_generation === 'error').length },
  ]

  return (
    <div className="min-h-screen" style={{ backgroundColor: colors.bg, color: colors.text }}>
      {/* Navigation */}
      <nav className="border-b" style={{ borderColor: colors.border, backgroundColor: colors.card }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center gap-3">
              <svg className="w-8 h-8" fill="none" stroke={colors.primary} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <span className="text-xl font-bold" style={{ color: colors.primary }}>
                VideoGen
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setDarkMode(!darkMode)
                  document.documentElement.classList.toggle('dark', !darkMode)
                }}
                className="p-2 rounded-lg transition-colors"
                style={{ backgroundColor: colors.border }}
              >
                {darkMode ? (
                  <svg className="w-5 h-5" fill="none" stroke={colors.text} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke={colors.text} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                )}
              </button>
              <a
                href="/generate"
                className="px-4 py-2 rounded-lg font-medium transition-colors"
                style={{ color: colors.textSecondary }}
              >
                Generate
              </a>
              <a
                href="/library"
                className="px-4 py-2 rounded-lg font-medium transition-colors"
                style={{ backgroundColor: colors.primary, color: darkMode ? colors.bg : '#fff' }}
              >
                My Library
              </a>
              <a
                href="/settings"
                className="px-4 py-2 rounded-lg font-medium transition-colors"
                style={{ color: colors.textSecondary }}
              >
                Settings
              </a>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold mb-6">My Library</h1>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setCurrentTab(tab.id)}
              className="px-4 py-2 rounded-lg font-medium transition-all whitespace-nowrap"
              style={{
                backgroundColor: currentTab === tab.id ? colors.primary : 'transparent',
                color: currentTab === tab.id ? '#fff' : colors.textSecondary,
                border: currentTab !== tab.id ? `1px solid ${colors.border}` : 'none',
              }}
            >
              {tab.label}
              <span
                className="ml-2 px-2 py-0.5 rounded-full text-xs"
                style={{
                  backgroundColor: currentTab === tab.id ? 'rgba(255,255,255,0.2)' : colors.border,
                  color: currentTab === tab.id ? '#fff' : colors.textSecondary,
                }}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Video List */}
        <div className="space-y-4">
          {loading ? (
            <div className="rounded-xl p-12 text-center" style={{ backgroundColor: colors.card }}>
              <svg className="animate-spin w-10 h-10 mx-auto" style={{ color: colors.primary }} fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <p className="mt-4" style={{ color: colors.textSecondary }}>Loading videos...</p>
            </div>
          ) : filteredVideos.length === 0 ? (
            <div className="rounded-xl p-12 text-center" style={{ backgroundColor: colors.card }}>
              <svg className="w-16 h-16 mx-auto mb-4" style={{ color: colors.textSecondary }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              <p className="text-lg font-medium" style={{ color: colors.textSecondary }}>
                {currentTab === 'all' ? 'No videos yet' :
                 currentTab === 'processing' ? 'No videos in progress' :
                 currentTab === 'completed' ? 'No completed videos' : 'No errors'}
              </p>
              <p className="text-sm mt-2" style={{ color: colors.textSecondary }}>
                {currentTab === 'all' ? 'Generate your first video to get started!' : ''}
              </p>
              {currentTab === 'all' && (
                <a
                  href="/generate"
                  className="inline-block mt-4 px-6 py-3 rounded-lg font-medium transition-all transform hover:scale-105"
                  style={{ backgroundColor: colors.primary, color: '#fff' }}
                >
                  Generate Video
                </a>
              )}
            </div>
          ) : (
            filteredVideos.map((video) => (
              <VideoCard
                key={video.id}
                video={video}
                colors={colors}
                onPreview={handlePreview}
                onDownload={handleDownload}
                onRefresh={loadVideos}
              />
            ))
          )}
        </div>
      </div>

      {/* Preview Modal */}
      {previewVideo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)' }}
            onClick={() => setPreviewVideo(null)}
          />
          <div className="relative w-full max-w-4xl rounded-2xl overflow-hidden shadow-2xl" style={{ backgroundColor: colors.card }}>
            <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: colors.border }}>
              <h3 className="text-lg font-semibold">Video Preview #{previewVideo.id}</h3>
              <button
                onClick={() => setPreviewVideo(null)}
                className="p-2 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="aspect-video bg-black">
              <video
                src={previewVideo.url}
                controls
                autoPlay
                className="w-full h-full"
              >
                Your browser does not support the video tag.
              </video>
            </div>
            <div className="flex items-center justify-between p-4 border-t" style={{ borderColor: colors.border }}>
              <p className="text-sm" style={{ color: colors.textSecondary }}>
                {previewVideo.expiresAt && `Expires: ${new Date(previewVideo.expiresAt).toLocaleString()}`}
              </p>
              <button
                onClick={() => {
                  setPreviewVideo(null)
                  handleDownload(previewVideo.id)
                }}
                className="px-6 py-2 rounded-lg font-medium transition-all hover:scale-105"
                style={{ backgroundColor: colors.primary, color: '#fff' }}
              >
                Download Video
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// VideoCard Component with live WebSocket updates
function VideoCard({
  video,
  colors,
  onPreview,
  onDownload,
  onRefresh,
}: {
  video: Video
  colors: any
  onPreview: (id: number) => void
  onDownload: (id: number) => void
  onRefresh: () => void
}) {
  const [localStatus, setLocalStatus] = useState<VideoStatus | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  // Connect to WebSocket for live updates
  useEffect(() => {
    // Only connect for non-completed/non-error videos
    if (video.phase_of_generation === 'completed' || video.phase_of_generation === 'error') {
      return
    }

    const ws = connectWebSocket(String(video.id), (data) => {
      if (data.type === 'phase_update') {
        setLocalStatus({
          id: video.id,
          phase_of_generation: data.payload.phase,
          progress: data.payload.progress,
        })
      } else if (data.type === 'completed') {
        setLocalStatus({
          id: video.id,
          phase_of_generation: 'completed',
          progress: 100,
          download_url: data.payload.download_url,
        })
        onRefresh()
      } else if (data.type === 'error') {
        setLocalStatus({
          id: video.id,
          phase_of_generation: 'error',
          progress: 0,
          error: data.payload.message,
        })
        onRefresh()
      }
    })

    wsRef.current = ws

    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [video.id, video.phase_of_generation])

  const currentPhase = localStatus?.phase_of_generation || video.phase_of_generation
  const isProcessing = !['completed', 'error'].includes(currentPhase)

  const getPhaseLabel = (phase: string) => {
    const labels: Record<string, string> = {
      pending: 'Waiting',
      transcribing: 'Transcribing',
      chunking: 'Splitting',
      translating: 'Translating',
      generating_assets: 'Creating assets',
      composing: 'Compiling',
      uploading: 'Uploading',
      completed: 'Ready',
      error: 'Failed',
    }
    return labels[phase] || phase
  }

  const getPhaseProgress = (phase: string) => {
    const progress: Record<string, number> = {
      pending: 0,
      transcribing: 10,
      chunking: 20,
      translating: 35,
      generating_assets: 50,
      composing: 75,
      uploading: 90,
      completed: 100,
      error: 0,
    }
    return progress[phase] || 0
  }

  const getHumanReadableError = (error: string | { String: string; Valid: boolean } | undefined): string => {
    if (!error) return ''
    if (typeof error === 'string') return error
    if (error.Valid) return error.String
    return ''
  }

  return (
    <div
      className="rounded-xl p-5 shadow-lg transition-transform hover:scale-[1.01] fade-transition"
      style={{ backgroundColor: colors.card, border: `1px solid ${colors.border}` }}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {/* Status Icon */}
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
            style={{
              backgroundColor: currentPhase === 'completed' ? colors.success :
                             currentPhase === 'error' ? colors.error :
                             `${colors.warning}20`,
            }}
          >
            {currentPhase === 'completed' ? (
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : currentPhase === 'error' ? (
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-6 h-6 animate-spin" style={{ color: colors.warning }} fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            )}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-lg">Video #{video.id}</h3>
              <span
                className="px-2 py-0.5 rounded text-xs font-medium uppercase"
                style={{
                  backgroundColor: `${colors.primary}15`,
                  color: colors.primary,
                }}
              >
                {video.output_language}
              </span>
            </div>
            <p className="text-sm" style={{ color: colors.textSecondary }}>
              {new Date(video.created_at).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Phase Label */}
          <span
            className="px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{
              backgroundColor: currentPhase === 'completed' ? `${colors.success}15` :
                             currentPhase === 'error' ? `${colors.error}15` :
                             `${colors.warning}15`,
              color: currentPhase === 'completed' ? colors.success :
                    currentPhase === 'error' ? colors.error :
                    colors.warning,
            }}
          >
            {getPhaseLabel(currentPhase)}
          </span>

          {/* Progress bar for processing */}
          {isProcessing && (
            <div className="w-24">
              <div className="h-1.5 rounded-full" style={{ backgroundColor: colors.border }}>
                <div
                  className="h-1.5 rounded-full"
                  style={{ width: `${getPhaseProgress(currentPhase)}%`, backgroundColor: colors.primary }}
                />
              </div>
            </div>
          )}

          {/* Action Buttons */}
          {currentPhase === 'completed' && (
            <div className="flex gap-2">
              <button
                onClick={() => onPreview(video.id)}
                className="px-4 py-2 rounded-lg font-medium transition-all hover:scale-105 flex items-center gap-2"
                style={{ backgroundColor: colors.accent, color: '#fff' }}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Preview
              </button>
              {!video.downloaded ? (
                <button
                  onClick={() => onDownload(video.id)}
                  className="px-4 py-2 rounded-lg font-medium transition-all hover:scale-105"
                  style={{ backgroundColor: colors.primary, color: '#fff' }}
                >
                  Download
                </button>
              ) : (
                <span className="px-4 py-2 rounded-lg text-sm flex items-center" style={{ color: colors.success }}>
                  <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Saved
                </span>
              )}
              {/* Open Editor Button - Shimmer for completed videos */}
              <a
                href={`/editor/${video.id}`}
                className="shimmer-button px-4 py-2 rounded-lg font-medium transition-all hover:scale-105"
                style={{
                  '--shimmer-color': colors.primary,
                  '--shimmer-highlight': colors.primaryHover,
                  color: '#fff',
                } as any}
              >
                Open Editor
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Error Message */}
      {currentPhase === 'error' && video.error_message && (
        <div className="mt-4 p-4 rounded-lg" style={{ backgroundColor: `${colors.error}10`, border: `1px solid ${colors.error}20` }}>
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: colors.error }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="font-medium" style={{ color: colors.error }}>Error Details</p>
              <p className="text-sm mt-1" style={{ color: colors.textSecondary }}>
                {getHumanReadableError(video.error_message)}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
