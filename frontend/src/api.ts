const API_URL = import.meta.env.VITE_API_URL || ''
const WS_URL = import.meta.env.VITE_WS_URL || ''

function resolveAPIUrl(endpoint: string) {
  return API_URL ? `${API_URL}${endpoint}` : endpoint
}

function resolveWebSocketUrl(path: string) {
  if (WS_URL) {
    return `${WS_URL}${path}`
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${path}`
}

async function fetchAPI(endpoint: string, options: RequestInit = {}) {
  const url = resolveAPIUrl(endpoint)

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

  extractDocument: async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)

		const response = await fetch(resolveAPIUrl('/api/video/extract-document'), {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(text || 'Document upload failed')
    }

    return response.json()
  },

  // Editor
  uploadMedia: async (file: File, type: string) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('type', type)

		const response = await fetch(resolveAPIUrl('/api/editor/upload-media'), {
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

  renderEditedVideo: async (videoId: string, data: any) => {
		const response = await fetch(resolveAPIUrl(`/api/editor/video/${videoId}/render`), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(text || 'Render failed')
    }

    return response.blob()
  },

	saveProject: (name: string, project: any) =>
		fetchAPI('/api/editor/project/save', {
			method: 'POST',
			body: JSON.stringify({ name, project }),
		}),

	listProjects: () =>
		fetchAPI('/api/editor/projects'),

	loadProject: (projectId: string) =>
		fetchAPI(`/api/editor/project/${projectId}`),
}

export function connectWebSocket(videoId: string, onMessage: (data: any) => void) {
	const ws = new WebSocket(resolveWebSocketUrl(`/ws/video/${videoId}`))

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
