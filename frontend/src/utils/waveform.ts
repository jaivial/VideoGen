// Audio waveform utilities

export interface WaveformData {
  peaks: number[]  // Normalized peaks (0-1)
  duration: number // Audio duration in seconds
}

// Generate waveform data from an audio URL
export async function generateWaveform(audioUrl: string, samples: number = 200): Promise<WaveformData> {
  return new Promise((resolve, reject) => {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    const audio = new Audio()
    audio.crossOrigin = 'anonymous'

    audio.onload = async () => {
      try {
        const duration = audio.duration
        const arrayBuffer = await fetch(audioUrl).then(r => r.arrayBuffer())
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

        // Get channel data
        const channelData = audioBuffer.getChannelData(0)
        const blockSize = Math.floor(channelData.length / samples)
        const peaks: number[] = []

        for (let i = 0; i < samples; i++) {
          const start = i * blockSize
          let sum = 0
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(channelData[start + j])
          }
          peaks.push(sum / blockSize)
        }

        // Normalize peaks
        const maxPeak = Math.max(...peaks)
        const normalizedPeaks = peaks.map(p => p / maxPeak)

        resolve({ peaks: normalizedPeaks, duration })
      } catch (err) {
        reject(err)
      }
    }

    audio.onerror = () => reject(new Error('Failed to load audio'))
    audio.src = audioUrl
  })
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
