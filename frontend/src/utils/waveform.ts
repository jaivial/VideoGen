// Audio waveform utilities

export interface WaveformData {
  peaks: number[]  // Normalized peaks (0-1)
  duration: number // Audio duration in seconds
}

export async function generateWaveformFromArrayBuffer(arrayBuffer: ArrayBuffer, samples: number = 200): Promise<WaveformData> {
  const AudioContextImpl = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext
  const audioContext = new AudioContextImpl()

  try {
    // Some browsers detach the underlying buffer while decoding
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0))
    const duration = audioBuffer.duration || 0

    const channelData = audioBuffer.getChannelData(0)
    const safeSamples = Math.max(8, Math.min(samples, 2000))
    const blockSize = Math.max(1, Math.floor(channelData.length / safeSamples))

    const peaks: number[] = []
    for (let i = 0; i < safeSamples; i++) {
      const start = i * blockSize
      const end = Math.min(channelData.length, start + blockSize)
      let sum = 0
      for (let j = start; j < end; j++) {
        sum += Math.abs(channelData[j])
      }
      peaks.push(sum / Math.max(1, end - start))
    }

    const maxPeak = Math.max(...peaks, 1e-6)
    const normalizedPeaks = peaks.map(p => Math.min(1, p / maxPeak))

    return { peaks: normalizedPeaks, duration }
  } finally {
    // Avoid leaking AudioContexts on repeated imports
    if (typeof audioContext.close === 'function') {
      await audioContext.close().catch(() => {})
    }
  }
}

// Generate waveform data from an audio URL
export async function generateWaveform(audioUrl: string, samples: number = 200): Promise<WaveformData> {
  const arrayBuffer = await fetch(audioUrl).then(r => r.arrayBuffer())
  return generateWaveformFromArrayBuffer(arrayBuffer, samples)
}

// Generate mock waveform data for preview (without actual audio)
export function generateMockWaveform(duration: number, samples: number = 100): WaveformData {
  const peaks: number[] = []

  for (let i = 0; i < samples; i++) {
    // Create a more realistic looking waveform
    const base = Math.random() * 0.3
    const mid = Math.sin(i / 10) * 0.2
    const high = Math.random() * 0.5
    peaks.push(Math.min(1, base + mid + high))
  }

  return { peaks, duration }
}

// Canvas renderer for waveform
export function renderWaveform(
  canvas: HTMLCanvasElement,
  peaks: number[],
  color: string = '#4ade80',
  backgroundColor: string = 'transparent'
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const { width, height } = canvas
  const centerY = height / 2

  // Clear
  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, width, height)

  // Draw waveform
  ctx.fillStyle = color
  const barWidth = width / peaks.length

  peaks.forEach((peak, i) => {
    const barHeight = peak * height * 0.8
    const x = i * barWidth
    const y = centerY - barHeight / 2

    ctx.fillRect(x, y, barWidth - 1, barHeight)
  })
}
