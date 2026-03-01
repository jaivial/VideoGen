import { useEffect, useMemo, useState } from 'react'
import { useEditorStore } from '../../../stores/editorStore'
import { RESOLUTIONS } from '../../../types/editor'
import { api } from '../../../api'

interface ExportPanelProps {
  videoId?: string
}

export function ExportPanel({ videoId }: ExportPanelProps) {
  const { duration, tracks } = useEditorStore()

  const [resolution, setResolution] = useState('1920x1080')
  const [frameRate, setFrameRate] = useState(30)
  const [quality, setQuality] = useState(23) // CRF value (lower = better)
  const [format, setFormat] = useState<'mp4' | 'webm'>('mp4')
  const [includeAudio, setIncludeAudio] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      if (resultUrl?.startsWith('blob:')) URL.revokeObjectURL(resultUrl)
    }
  }, [resultUrl])

  const { width, height } = useMemo(() => {
    const [w, h] = resolution.split('x').map((v) => parseInt(v, 10))
    return { width: w || 1920, height: h || 1080 }
  }, [resolution])

  const payload = useMemo(() => ({
    mode: 'export',
    tracks,
    export: {
      width,
      height,
      frameRate,
      format,
      crf: quality,
      includeAudio,
    },
  }), [tracks, width, height, frameRate, format, quality, includeAudio])

  const hasLocalOnlyClips = useMemo(() => {
    for (const track of tracks) {
      for (const clip of track.clips as any[]) {
        if (typeof clip.url === 'string' && clip.url.startsWith('blob:')) {
          return true
        }
      }
    }
    return false
  }, [tracks])

  const runRender = async (mode: 'preview' | 'export') => {
    if (!videoId) {
      setError('Missing video id')
      return
    }
    if (format === 'webm') {
      setError('WebM export not supported yet')
      return
    }
    if (hasLocalOnlyClips) {
      setError('Some clips are local-only blob URLs. Re-upload those media files before server render.')
      return
    }

    setError(null)
    setIsExporting(true)

    try {
      const blob = await api.renderEditedVideo(videoId, { ...payload, mode })
      const url = URL.createObjectURL(blob)
      setResultUrl((prev) => {
        if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev)
        return url
      })

      if (mode === 'export') {
        const a = document.createElement('a')
        a.href = url
        a.download = `edited_${videoId}.mp4`
        a.click()
      }
    } catch (err: any) {
      setError(err.message || 'Render failed')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700">
        <h3 className="text-sm font-semibold text-white">Export Video</h3>
      </div>

      {/* Export settings */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && (
          <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-200 text-sm">
            {error}
          </div>
        )}

        {/* Resolution */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">Resolution</label>
          <select
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            className="w-full px-3 py-2 bg-gray-800 text-white text-sm rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500"
          >
            {RESOLUTIONS.map((res) => (
              <option key={res.label} value={`${res.width}x${res.height}`}>
                {res.label} ({res.width}x{res.height})
              </option>
            ))}
          </select>
        </div>

        {/* Frame rate */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">Frame Rate</label>
          <select
            value={frameRate}
            onChange={(e) => setFrameRate(parseInt(e.target.value))}
            className="w-full px-3 py-2 bg-gray-800 text-white text-sm rounded-lg border border-gray-700 focus:outline-none focus:border-blue-500"
          >
            <option value={24}>24 fps (Cinema)</option>
            <option value={30}>30 fps (Standard)</option>
            <option value={60}>60 fps (Smooth)</option>
          </select>
        </div>

        {/* Quality */}
        <div>
          <div className="flex justify-between mb-1">
            <label className="text-xs text-gray-400">Quality</label>
            <span className="text-xs text-gray-500">
              {quality < 18 ? 'High' : quality < 23 ? 'Medium' : 'Low'} ({quality})
            </span>
          </div>
          <input
            type="range"
            min={15}
            max={35}
            value={quality}
            onChange={(e) => setQuality(parseInt(e.target.value))}
            className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-gray-600 mt-1">
            <span>Best</span>
            <span>Smallest</span>
          </div>
        </div>

        {/* Format */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">Format</label>
          <div className="flex gap-2">
            <button
              onClick={() => setFormat('mp4')}
              className={`flex-1 py-2 text-sm rounded-lg border ${
                format === 'mp4'
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
              }`}
            >
              MP4
            </button>
            <button
              onClick={() => setFormat('webm')}
              className={`flex-1 py-2 text-sm rounded-lg border ${
                format === 'webm'
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
              }`}
            >
              WebM
            </button>
          </div>
        </div>

        {/* Include audio */}
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={includeAudio}
            onChange={(e) => setIncludeAudio(e.target.checked)}
          />
          Include audio
        </label>

        {/* Estimated file size */}
        <div className="p-3 bg-gray-800 rounded-lg">
          <div className="text-xs text-gray-400">Estimated file size</div>
          <div className="text-lg font-semibold text-white">
            ~{Math.round(duration * (format === 'mp4' ? 1 : 0.7) * (40 - quality))} MB
          </div>
        </div>

        {/* Result preview */}
        {resultUrl && (
          <div className="space-y-2">
            <div className="text-xs text-gray-400">Rendered preview</div>
            <video src={resultUrl} controls className="w-full rounded-lg border border-gray-700 bg-black" />
            <button
              onClick={() => {
                const a = document.createElement('a')
                a.href = resultUrl
                a.download = `edited_${videoId || 'video'}.mp4`
                a.click()
              }}
              className="w-full py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-lg border border-white/10"
            >
              Download rendered file
            </button>
          </div>
        )}
      </div>

      {/* Export button */}
      <div className="p-4 border-t border-gray-700">
        <div className="flex gap-2">
          <button
            onClick={() => runRender('preview')}
            disabled={duration === 0 || !videoId || isExporting || hasLocalOnlyClips}
            className="flex-1 py-3 bg-white/10 hover:bg-white/15 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-lg border border-white/10"
          >
            {isExporting ? 'Rendering…' : 'Preview render'}
          </button>

          <button
            onClick={() => runRender('export')}
            disabled={duration === 0 || !videoId || isExporting || hasLocalOnlyClips}
            className="flex-1 py-3 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-medium rounded-lg flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {isExporting ? 'Rendering…' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  )
}
