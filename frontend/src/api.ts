const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080'
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8080'

async function fetchAPI(endpoint: string, options: RequestInit = {}) {
  const url = `${API_URL}${endpoint}`

  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }))
    throw new Error(error.message || 'Request failed')
  }

  return response.json()
}

export const api = {
  // Auth
  register: (data: { name: string; email: string; password: string }) =>
    fetchAPI('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  login: (data: { email: string; password: string }) =>
    fetchAPI('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  logout: () =>
    fetchAPI('/api/auth/logout', {
      method: 'POST',
    }),

  verify: (token: string) =>
    fetchAPI(`/api/auth/verify?token=${token}`),

  me: () => fetchAPI('/api/auth/me'),

  // Video
  generateVideo: (data: { transcribed_text: string; output_language: string; voice?: string; style_instruction?: string }) =>
    fetchAPI('/api/video/generate', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getVideoStatus: (id: string) =>
    fetchAPI(`/api/video/status?id=${id}`),

  listVideos: () =>
    fetchAPI('/api/video/list'),

  markDownloaded: (id: string) =>
    fetchAPI('/api/video/mark-downloaded', {
      method: 'POST',
      body: JSON.stringify({ id }),
    }),

  getLanguages: () =>
    fetchAPI('/api/video/languages'),

  // Editor
  uploadMedia: async (file: File, type: string) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('type', type)

    const response = await fetch(`${API_URL}/api/editor/upload-media`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Upload failed' }))
      throw new Error(error.message || 'Upload failed')
    }

    return response.json()
  },

  processEditedVideo: (videoId: string, data: {
    video_timeline: any[]
    audio_timeline: any[]
    captions: any[]
  }) =>
    fetchAPI(`/api/editor/video/${videoId}/process`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getVideoAssets: (videoId: string) =>
    fetchAPI(`/api/editor/video/${videoId}/assets`),
}

export function connectWebSocket(videoId: string, onMessage: (data: any) => void) {
  const ws = new WebSocket(`${WS_URL}/ws/video/${videoId}`)

  ws.onopen = () => {
    console.log('WebSocket connected')
  }

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data)
    onMessage(data)
  }

  ws.onerror = (error) => {
    console.error('WebSocket error:', error)
  }

  ws.onclose = () => {
    console.log('WebSocket closed')
  }

  return ws
}
