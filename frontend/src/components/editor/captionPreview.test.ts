import { describe, expect, it } from 'vitest'
import { DEFAULT_CAPTION_STYLE } from '../../types/editor'
import { getCaptionPreviewState } from './captionPreview'

describe('getCaptionPreviewState', () => {
  it('fades caption opacity in during the configured animation duration', () => {
    const result = getCaptionPreviewState(
      {
        startTime: 0,
        duration: 4,
        text: 'Fade caption',
        style: {
          ...DEFAULT_CAPTION_STYLE,
          animation: 'fade',
          animationDuration: 1,
        },
      } as any,
      0.25,
    )

    expect(result.style.opacity).toBeCloseTo(0.25, 2)
  })

  it('reveals typewriter captions progressively in the preview', () => {
    const result = getCaptionPreviewState(
      {
        startTime: 0,
        duration: 4,
        text: 'Animated caption',
        style: {
          ...DEFAULT_CAPTION_STYLE,
          animation: 'typewriter',
          animationDuration: 2,
        },
      } as any,
      1,
    )

    expect(result.text).toBe('Animated')
    expect(result.text).not.toBe('Animated caption')
  })

  it('adds a pop-scale transform near the start of a pop animation', () => {
    const result = getCaptionPreviewState(
      {
        startTime: 0,
        duration: 4,
        text: 'Pop caption',
        style: {
          ...DEFAULT_CAPTION_STYLE,
          animation: 'pop',
          animationDuration: 1,
          animationStrength: 1,
        },
      } as any,
      0.1,
    )

    expect(String(result.style.transform)).toContain('scale(')
  })
})
