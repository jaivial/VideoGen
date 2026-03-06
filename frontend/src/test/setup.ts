import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// Mock window.URL.createObjectURL
const mockCreateObjectURL = vi.fn((file: Blob) => `blob:${file.type || 'application/octet-stream'}/${Date.now()}`)
const mockRevokeObjectURL = vi.fn()

Object.defineProperty(window, 'URL', {
  value: {
    createObjectURL: mockCreateObjectURL,
    revokeObjectURL: mockRevokeObjectURL,
  },
  writable: true,
})

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock requestAnimationFrame
globalThis.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
  return setTimeout(callback, 0) as unknown as number
})
globalThis.cancelAnimationFrame = vi.fn((id: number) => clearTimeout(id))

// Mock scrollTo
Object.defineProperty(Element.prototype, 'scrollTo', {
  writable: true,
  value: vi.fn(),
})

// Mock getBoundingClientRect
Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
  writable: true,
  value: vi.fn(() => new DOMRect(0, 0, 100, 100)),
})
