import { useState, useEffect, useMemo, useRef, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, connectWebSocket } from '../../api'
import { AppNavigation } from '../../components/AppNavigation'
import { CustomSelect } from '../../components/ui/CustomSelect'

// Available voices for Qwen3 TTS
const AVAILABLE_VOICES = [
  { id: 'Vivian', name: 'Vivian', description: 'Bright, high-energy female voice' },
  { id: 'Serena', name: 'Serena', description: 'Soft, friendly female voice' },
  { id: 'Ono_Anna', name: 'Ono Anna', description: 'Warm female voice' },
  { id: 'Sohee', name: 'Sohee', description: 'Cheerful female voice' },
  { id: 'Uncle_Fu', name: 'Uncle Fu', description: 'Friendly male voice' },
  { id: 'Dylan', name: 'Dylan', description: 'Professional male voice' },
  { id: 'Eric', name: 'Eric', description: 'Deep male voice' },
  { id: 'Ryan', name: 'Ryan', description: 'Casual male voice' },
  { id: 'Aiden', name: 'Aiden', description: 'Young adult male voice' },
]

// Languages supported by Qwen3 TTS
const SUPPORTED_LANGUAGES = [
  { code: 'auto', name: 'Auto Detect' },
  { code: 'en', name: 'English' },
  { code: 'zh', name: 'Chinese' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'es', name: 'Spanish' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'fr', name: 'French' },
  { code: 'ru', name: 'Russian' },
]

const LANGUAGE_OPTIONS = SUPPORTED_LANGUAGES.map((lang) => ({
  value: lang.code,
  label: lang.name,
}))

const VOICE_OPTIONS = AVAILABLE_VOICES.map((voice) => ({
  value: voice.id,
  label: `${voice.name} - ${voice.description}`,
}))

// Default style instruction
const DEFAULT_STYLE_INSTRUCTION = "A warm, engaging narrator voice. Moderate pace, storytelling style, professional audiobook narrator quality. Expressive but not dramatic, perfect for educational content. Consistent tone and rhythm throughout. Clear diction, confident delivery."

interface VideoStatus {
  id: number
  phase_of_generation: string
  progress: number
  step?: string
  message?: string
  download_url?: string
  downloaded?: boolean
  download_expires_at?: string
  error?: string
}

type Step = 1 | 2 | 3 | 4 | 5  // 1=transcript, 2=language, 3=voice, 4=loading, 5=completed
type TranscriptInputMode = 'paste' | 'upload'

// Helper functions at module level
function getPhaseLabel(phase: string) {
  const labels: Record<string, string> = {
    pending: 'Waiting',
    transcribing: 'Transcribing audio',
    chunking: 'Splitting text',
    translating: 'Translating',
    generating_assets: 'Creating images & voice',
    composing: 'Compiling video',
    uploading: 'Uploading',
    completed: 'Ready',
    error: 'Failed',
  }
  return labels[phase] || phase
}

function getPhaseProgress(phase: string) {
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

export default function Generate() {
  const navigate = useNavigate()
  const [transcribedText, setTranscribedText] = useState('')
  const [transcriptInputMode, setTranscriptInputMode] = useState<TranscriptInputMode>('paste')
  const [uploadedDocument, setUploadedDocument] = useState<{ name: string; type: string } | null>(null)
  const [documentError, setDocumentError] = useState('')
  const [isExtractingDocument, setIsExtractingDocument] = useState(false)
  const [language, setLanguage] = useState('en')
  const [voice, setVoice] = useState('Vivian')
  const [styleInstruction, setStyleInstruction] = useState(DEFAULT_STYLE_INSTRUCTION)
  const [darkMode, setDarkMode] = useState(false)
  const [currentStep, setCurrentStep] = useState<Step>(1)
  const [animationKey, setAnimationKey] = useState(0)
  const [status, setStatus] = useState<VideoStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [previewVideo, setPreviewVideo] = useState<{id: number; url: string; expiresAt?: string} | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const completionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
  }, [])

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current)
      }
    }
  }, [])

  const goToStep = (step: Step) => {
    setCurrentStep(step)
    setAnimationKey(prev => prev + 1)
  }

  const handleNext = () => {
    if (currentStep === 1 && transcribedText.trim()) {
      goToStep(2)
    } else if (currentStep === 2) {
      goToStep(3)
    } else if (currentStep === 3) {
      startGeneration()
    }
  }

  const handleBack = () => {
    if (currentStep === 2) {
      goToStep(1)
    } else if (currentStep === 3) {
      goToStep(2)
    }
  }

  const startGeneration = async () => {
    setError('')
    setLoading(true)
    setStatus(null)
    goToStep(4)

    try {
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current)
        completionTimeoutRef.current = null
      }

      const result = await api.generateVideo({
        transcribed_text: transcribedText,
        output_language: language,
        voice: voice,
        style_instruction: styleInstruction,
      })

      const videoId = result.request_id

      // Connect WebSocket
      const ws = connectWebSocket(String(videoId), (data) => {
        const payload = data?.payload || {}

        if (data.type === 'step_update' || data.type === 'phase_update') {
          setStatus({
            id: videoId,
            phase_of_generation: payload.phase ?? data.phase ?? 'pending',
            progress: Number(payload.progress ?? data.progress ?? 0),
            step: payload.step ?? data.step,
            message: payload.message ?? data.message,
          })
        } else if (data.type === 'completed' || (data.type === 'phase_update' && (payload.phase ?? data.phase) === 'completed')) {
          setStatus({
            id: videoId,
            phase_of_generation: 'completed',
            progress: 100,
            download_url: payload.download_url,
            message: payload.message ?? data.message,
          })
          // 3-second autofill before completing
          completionTimeoutRef.current = setTimeout(() => {
            goToStep(5)
          }, 3000)
        } else if (data.type === 'error') {
          const errorMsg = payload.message ?? payload.error ?? data.message ?? data.error ?? 'Generation failed'
          setError(errorMsg)
          setStatus({
            id: videoId,
            phase_of_generation: 'error',
            progress: 0,
            error: errorMsg,
            message: errorMsg,
          })
        }
      })

      wsRef.current = ws

    } catch (err: any) {
      setError(err.message || 'Failed to start generation')
      goToStep(3) // Go back to form on error
    } finally {
      setLoading(false)
    }
  }

  const handleDocumentUpload = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0]
		if (!file) {
			return
		}

		setDocumentError('')
		setUploadedDocument(null)
		setIsExtractingDocument(true)

		try {
			const result = await api.extractDocument(file)
			setTranscribedText(result.text || '')
			setUploadedDocument({
				name: result.filename || file.name,
				type: result.file_type || '',
			})
		} catch (err: any) {
			setDocumentError(err.message || 'Failed to extract document')
		} finally {
			setIsExtractingDocument(false)
			event.target.value = ''
		}
	}

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

  const getHumanReadableError = (errorMsg: string) => {
    if (!errorMsg) return 'An unknown error occurred'

    const errorMappings: Record<string, string> = {
      'ECONNRESET': 'YouTube blocked the server IP. Please use a proxy or try a different video.',
      'failed to run transcript script': 'Could not download the video transcript.',
      'failed to get transcript': 'Could not get the video transcript.',
      'module not found': 'Server configuration error. Please contact support.',
      'timeout': 'The operation took too long. Please try again.',
      'authentication': 'Authentication failed.',
      'rate limit': 'Too many requests. Please wait a moment and try again.',
      'quota': 'API quota exceeded. Please try again later.',
      'failed to translate': 'Translation service failed.',
      'failed to generate image': 'Image generation failed.',
      'failed to generate audio': 'Voice generation failed.',
      'failed to compose video': 'Video composition failed.',
      'failed to upload': 'Video upload failed.',
    }

    const lowerError = errorMsg.toLowerCase()
    for (const [key, readable] of Object.entries(errorMappings)) {
      if (lowerError.includes(key.toLowerCase())) {
        return readable
      }
    }

    return errorMsg.charAt(0).toUpperCase() + errorMsg.slice(1)
  }

  const startAnotherVideo = () => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    setCurrentStep(1)
    setTranscribedText('')
    setTranscriptInputMode('paste')
    setUploadedDocument(null)
    setDocumentError('')
    setLanguage('en')
    setVoice('Vivian')
    setStatus(null)
    setError('')
  }

  const canProceed = () => {
    if (currentStep === 1) return transcribedText.trim().length > 0
    if (currentStep === 2) return language.length > 0
    if (currentStep === 3) return voice.length > 0
    return false
  }

  // Render step content with fade animation
  const renderStepContent = () => {
    return (
      <div key={animationKey} className="fade-transition">
        {currentStep === 1 && (
          <div className="space-y-5">
            <div className="flex gap-3 rounded-xl p-1" style={{ backgroundColor: colors.bg }}>
              <button
                type="button"
                onClick={() => {
                  setTranscriptInputMode('paste')
                  setDocumentError('')
                }}
                className="flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
                style={{
                  backgroundColor: transcriptInputMode === 'paste' ? colors.primary : 'transparent',
                  color: transcriptInputMode === 'paste' ? '#fff' : colors.textSecondary,
                }}
              >
                Paste transcript
              </button>
              <button
                type="button"
                onClick={() => {
                  setTranscriptInputMode('upload')
                  setDocumentError('')
                }}
                className="flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors"
                style={{
                  backgroundColor: transcriptInputMode === 'upload' ? colors.primary : 'transparent',
                  color: transcriptInputMode === 'upload' ? '#fff' : colors.textSecondary,
                }}
              >
                Upload file
              </button>
            </div>

            {transcriptInputMode === 'upload' && (
              <div
                className="rounded-xl border p-4"
                style={{ borderColor: colors.border, backgroundColor: colors.bg }}
              >
                <div className="space-y-3">
                  <div>
                    <label htmlFor="transcriptUpload" className="block text-sm font-medium mb-2">
                      Upload transcript file
                    </label>
                    <input
                      id="transcriptUpload"
                      type="file"
                      accept=".txt,.md,.docx,.pdf"
                      onChange={handleDocumentUpload}
                      disabled={isExtractingDocument}
                      className="block w-full text-sm"
                    />
                  </div>

                  <p className="text-sm" style={{ color: colors.textSecondary }}>
                    Supported formats: TXT, MD, DOCX, and text-based PDF.
                  </p>

                  {isExtractingDocument && (
                    <p className="text-sm font-medium" style={{ color: colors.primary }}>
                      Extracting text from your file...
                    </p>
                  )}

                  {uploadedDocument && (
                    <p className="text-sm font-medium" style={{ color: colors.text }}>
                      {uploadedDocument.name}
                    </p>
                  )}

                  {documentError && (
                    <p className="text-sm" style={{ color: colors.error }}>
                      {documentError}
                    </p>
                  )}
                </div>
              </div>
            )}

            <div>
              <label htmlFor="transcribedText" className="block text-sm font-medium mb-2">
                Transcript Text
              </label>
              <textarea
                id="transcribedText"
                value={transcribedText}
                onChange={(e) => setTranscribedText(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border transition-colors focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: colors.bg,
                  borderColor: colors.border,
                  color: colors.text,
                  '--tw-ring-color': colors.primary,
                } as any}
                placeholder={transcriptInputMode === 'upload' ? 'Uploaded text will appear here for review and editing...' : 'Paste the transcribed text from your video here...'}
                required
                rows={8}
              />
              <p className="mt-2 text-sm" style={{ color: colors.textSecondary }}>
                {transcriptInputMode === 'upload' ? 'Review the extracted text before continuing.' : (
                  <>
                    Tip: Use{' '}
                    <a
                      href="https://youtubetranscript.com/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline font-medium"
                      style={{ color: colors.primary }}
                    >
                      YouTube Transcript
                    </a>{' '}
                    to get the transcript from any YouTube video.
                  </>
                )}
              </p>
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <div>
            <CustomSelect
              id="language"
              label="Step 2: Select Output Language"
              value={language}
              onChange={setLanguage}
              options={LANGUAGE_OPTIONS}
              labelClassName="block text-sm font-medium mb-2"
              labelStyle={{ color: colors.text }}
              triggerClassName="w-full px-4 py-3 rounded-lg border transition-colors flex items-center justify-between gap-3"
              triggerStyle={{
                backgroundColor: colors.bg,
                borderColor: colors.border,
                color: colors.text,
              } as any}
              menuStyle={{
                backgroundColor: colors.card,
                borderColor: colors.border,
              } as any}
            />
            <p className="mt-2 text-sm" style={{ color: colors.textSecondary }}>
              The video will be generated in this language.
            </p>
          </div>
        )}

        {currentStep === 3 && (
          <div className="space-y-4">
            <div>
              <CustomSelect
                id="voice"
                label="Step 3: Select Voice"
                value={voice}
                onChange={setVoice}
                options={VOICE_OPTIONS}
                labelClassName="block text-sm font-medium mb-2"
                labelStyle={{ color: colors.text }}
                triggerClassName="w-full px-4 py-3 rounded-lg border transition-colors flex items-center justify-between gap-3"
                triggerStyle={{
                  backgroundColor: colors.bg,
                  borderColor: colors.border,
                  color: colors.text,
                } as any}
                menuStyle={{
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                } as any}
              />
            </div>

            <div>
              <label htmlFor="styleInstruction" className="block text-sm font-medium mb-2">
                Voice Style (Optional)
              </label>
              <textarea
                id="styleInstruction"
                value={styleInstruction}
                onChange={(e) => setStyleInstruction(e.target.value)}
                className="w-full px-4 py-3 rounded-lg border transition-colors focus:outline-none focus:ring-2"
                style={{
                  backgroundColor: colors.bg,
                  borderColor: colors.border,
                  color: colors.text,
                } as any}
                placeholder="Describe the voice style you want..."
                rows={3}
              />
            </div>
          </div>
        )}

        {currentStep === 4 && (
          <LoadingStep status={status} colors={colors} error={error} />
        )}

        {currentStep === 5 && status && (
          <CompletedStep
            status={status}
            colors={colors}
            onDownload={handleDownload}
            onPreview={handlePreview}
            onStartAnother={startAnotherVideo}
          />
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: colors.bg, color: colors.text }}>
      <AppNavigation
        colors={colors}
        darkMode={darkMode}
        activeTab="generate"
        onToggleDarkMode={() => {
          setDarkMode(!darkMode)
          document.documentElement.classList.toggle('dark', !darkMode)
        }}
      />

      <div className="max-w-3xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Step Indicator */}
        {currentStep !== 4 && currentStep !== 5 && (
          <div className="mb-8">
            <div className="flex items-center justify-between">
              {[1, 2, 3].map((step) => (
                <div key={step} className="flex items-center flex-1">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center font-medium transition-colors"
                    style={{
                      backgroundColor: currentStep >= step ? colors.primary : colors.border,
                      color: currentStep >= step ? '#fff' : colors.textSecondary,
                    }}
                  >
                    {currentStep > step ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      step
                    )}
                  </div>
                  {step < 3 && (
                    <div
                      className="flex-1 h-1 mx-2 rounded"
                      style={{
                        backgroundColor: currentStep > step ? colors.primary : colors.border,
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-between mt-2 text-sm" style={{ color: colors.textSecondary }}>
              <span>Transcript</span>
              <span>Language</span>
              <span>Voice</span>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && currentStep !== 4 && (
          <div className="mb-6 p-4 rounded-lg" style={{ backgroundColor: `${colors.error}15`, color: colors.error, border: `1px solid ${colors.error}30` }}>
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="font-medium">Generation Failed</p>
                <p className="text-sm mt-1">{getHumanReadableError(error)}</p>
              </div>
            </div>
          </div>
        )}

        {/* Form Card */}
        <div className="rounded-xl p-6 shadow-lg" style={{ backgroundColor: colors.card }}>
          <h2 className="text-xl font-semibold mb-6">
            {currentStep === 1 && 'Enter Transcript Text'}
            {currentStep === 2 && 'Select Output Language'}
            {currentStep === 3 && 'Choose Voice'}
            {currentStep === 4 && 'Generating Your Video'}
            {currentStep === 5 && 'Video Ready!'}
          </h2>

          {renderStepContent()}

          {/* Navigation Buttons */}
          {currentStep !== 4 && currentStep !== 5 && (
            <div className="flex gap-4 mt-8">
              {currentStep > 1 && (
                <button
                  onClick={handleBack}
                  className="px-6 py-3 rounded-lg font-medium transition-colors"
                  style={{ color: colors.textSecondary, border: `1px solid ${colors.border}` }}
                >
                  Back
                </button>
              )}
              <button
                onClick={handleNext}
                disabled={!canProceed() || loading}
                className="flex-1 px-6 py-3 rounded-lg font-medium transition-all transform hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
                style={{ backgroundColor: colors.primary, color: '#fff' }}
              >
                {loading ? 'Starting...' : currentStep === 3 ? 'Generate Video' : 'Continue'}
              </button>
            </div>
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
              <div className="flex gap-3">
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
        </div>
      )}
    </div>
  )
}

// Loading Step Component with unified progress bar + particles
function LoadingStep({ status, colors, error }: { status: VideoStatus | null; colors: any; error: string }) {
  const [fallbackProgress, setFallbackProgress] = useState(0)
  const isDoneRef = useRef(false)

  useEffect(() => {
    isDoneRef.current = status?.phase_of_generation === 'completed' || status?.phase_of_generation === 'error'
  }, [status?.phase_of_generation])

  // Animation logic: 0-50% in 30 seconds, 50-100% in 120 seconds
  useEffect(() => {
    const startTime = Date.now()
    const duration1 = 30000 // 30 seconds for 0-50%
    const duration2 = 120000 // 120 seconds for 50-100%
    let rafId = 0

    const animate = () => {
      const elapsed = Date.now() - startTime

      let newProgress: number
      if (elapsed < duration1) {
        // 0-50% in 30 seconds
        newProgress = (elapsed / duration1) * 50
      } else {
        // 50-100% in 120 seconds
        const elapsedAfter50 = elapsed - duration1
        newProgress = 50 + (elapsedAfter50 / duration2) * 50
      }

      // Cap at 99% until actual completion
      const displayProgress = Math.min(newProgress, 99)
      setFallbackProgress(displayProgress)

      if (displayProgress < 99 && !isDoneRef.current) {
        rafId = requestAnimationFrame(animate)
      }
    }

    rafId = requestAnimationFrame(animate)

    return () => cancelAnimationFrame(rafId)
  }, [])

  const statusProgress = status?.progress ?? (status ? getPhaseProgress(status.phase_of_generation) : 0)
  const progress =
    status?.phase_of_generation === 'completed'
      ? 100
      : Math.min(Math.max(statusProgress, fallbackProgress), 99)

  return (
    <div className="text-center">
      <div className="max-w-md mx-auto">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium" style={{ color: colors.textSecondary }}>
            {status ? getPhaseLabel(status.phase_of_generation) : 'Starting'}
          </span>
          <span className="text-sm font-semibold" style={{ color: colors.text }}>
            {Math.round(progress)}%
          </span>
        </div>

        {/* Unified progress graph */}
        <div className="h-4 rounded-full overflow-hidden" style={{ backgroundColor: colors.border }}>
          <div
            className="h-full rounded-full relative overflow-hidden transition-[width] duration-500 ease-out"
            style={{
              width: `${progress}%`,
              background: `linear-gradient(90deg, ${colors.primary}, ${colors.accent})`,
            }}
          >
            <LoadingBarParticles />
          </div>
        </div>

        {/* Status message */}
        {status?.message && (
          <p className="text-sm mt-4" style={{ color: colors.textSecondary }}>
            {status.message}
          </p>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <p className="text-sm mt-3" style={{ color: colors.error }}>
          {error}
        </p>
      )}
    </div>
  )
}

function LoadingBarParticles() {
  const particles = useMemo(
    () => ({
      bubbles: Array.from({ length: 10 }, (_, i) => ({
        id: i,
        size: Math.random() * 10 + 4,
        left: Math.random() * 100,
        delay: Math.random() * 3,
        duration: Math.random() * 2 + 2.5,
      })),
      sparkles: Array.from({ length: 8 }, (_, i) => ({
        id: i,
        top: Math.random() * 100,
        left: Math.random() * 100,
        delay: Math.random() * 2.5,
        duration: Math.random() * 1.8 + 1.2,
      })),
    }),
    []
  )

  return (
    <div className="absolute inset-0 pointer-events-none">
      {particles.bubbles.map((bubble) => (
        <div
          key={bubble.id}
          className="absolute rounded-full opacity-25"
          style={{
            width: bubble.size,
            height: bubble.size,
            left: `${bubble.left}%`,
            bottom: '-10px',
            backgroundColor: '#fff',
            animation: `barFloat ${bubble.duration}s ease-in-out infinite`,
            animationDelay: `${bubble.delay}s`,
          }}
        />
      ))}

      {particles.sparkles.map((sparkle) => (
        <div
          key={`s-${sparkle.id}`}
          className="absolute"
          style={{
            width: 3,
            height: 3,
            top: `${sparkle.top}%`,
            left: `${sparkle.left}%`,
            borderRadius: 9999,
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            animation: `barSparkle ${sparkle.duration}s ease-in-out infinite`,
            animationDelay: `${sparkle.delay}s`,
          }}
        />
      ))}
    </div>
  )
}

// Completed Step Component
function CompletedStep({
  status,
  colors,
  onDownload,
  onPreview,
  onStartAnother,
}: {
  status: VideoStatus
  colors: any
  onDownload: (id: number) => void
  onPreview: (id: number) => void
  onStartAnother: () => void
}) {
  return (
    <div className="text-center">
      {/* Success Icon */}
      <div
        className="w-20 h-20 mx-auto mb-6 rounded-full flex items-center justify-center"
        style={{ backgroundColor: colors.success }}
      >
        <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <p className="text-lg mb-6" style={{ color: colors.textSecondary }}>
        Your video is ready for download!
      </p>

      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <button
          onClick={() => onPreview(status.id)}
          className="px-6 py-3 rounded-lg font-medium transition-all transform hover:scale-105 flex items-center gap-2"
          style={{ backgroundColor: colors.accent, color: '#fff' }}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Preview
        </button>
        <button
          onClick={() => onDownload(status.id)}
          className="px-6 py-3 rounded-lg font-medium transition-all transform hover:scale-105"
          style={{ backgroundColor: colors.success, color: '#fff' }}
        >
          Download
        </button>
      </div>

      <button
        onClick={onStartAnother}
        className="mt-6 text-sm underline"
        style={{ color: colors.textSecondary }}
      >
        Start Another Video
      </button>
    </div>
  )
}
