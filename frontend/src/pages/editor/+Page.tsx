import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../../api'
import { Editor } from '../../components/editor'

export default function EditorPage() {
  const { videoId } = useParams<{ videoId: string }>()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [duration] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const checkAuth = async () => {
      try {
        await api.me()
      } catch {
        navigate('/login')
      }
    }
    checkAuth()
  }, [navigate])

  useEffect(() => {
    const loadVideo = async () => {
      if (!videoId) {
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        const status = await api.getVideoStatus(videoId)

        if (status.download_url) {
          setVideoUrl(status.download_url)
          // Duration will be set when the video loads in the editor
        } else {
          setError('Video not found')
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load video')
      } finally {
        setLoading(false)
      }
    }

    loadVideo()
  }, [videoId])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-10 w-10 text-blue-500 mx-auto mb-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p className="text-gray-400">Loading editor...</p>
        </div>
      </div>
    )
  }

  if (error && !videoUrl) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={() => navigate('/library')}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg"
          >
            Back to Library
          </button>
        </div>
      </div>
    )
  }

  return <Editor videoUrl={videoUrl || undefined} videoDuration={duration} />
}
