import type { CSSProperties } from 'react'
import { DEFAULT_CAPTION_STYLE, type CaptionClip, type CaptionStyle } from '../../types/editor'

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function hexToRgba(color: string | undefined, alpha: number): string {
  const normalizedAlpha = clamp(alpha, 0, 1)
  if (!color) return `rgba(0, 0, 0, ${normalizedAlpha})`

  const hex = color.trim().replace('#', '')
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    return color
  }

  const expanded = hex.length === 3
    ? hex.split('').map((part) => `${part}${part}`).join('')
    : hex

  if (expanded.length !== 6) {
    return color
  }

  const r = parseInt(expanded.slice(0, 2), 16)
  const g = parseInt(expanded.slice(2, 4), 16)
  const b = parseInt(expanded.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${normalizedAlpha})`
}

function applyTextTransform(text: string, transform: CaptionStyle['textTransform']) {
  switch (transform) {
    case 'uppercase':
      return text.toUpperCase()
    case 'lowercase':
      return text.toLowerCase()
    case 'capitalize':
      return text.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase())
    default:
      return text
  }
}

export function getCaptionPreviewState(caption: CaptionClip, currentTime: number): { text: string; style: CSSProperties } {
  const style = { ...DEFAULT_CAPTION_STYLE, ...(caption?.style || {}) }
  const alignment = style.alignment === 'left' || style.alignment === 'right' ? style.alignment : 'center'
  const position = style.position === 'top' || style.position === 'center' ? style.position : 'bottom'

  const fontSize = clamp(Number(style.fontSize) || 32, 14, 120)
  const fontWeight = clamp(Number(style.fontWeight) || 500, 300, 900)
  const strokeWidth = clamp(Number(style.strokeWidth) || 0, 0, 8)
  const lineHeight = clamp(Number(style.lineHeight) || 1.25, 1, 2.2)
  const backgroundOpacity = clamp(Number(style.backgroundOpacity) || 0, 0, 1)
  const letterSpacing = clamp(Number(style.letterSpacing) || 0, -2, 12)
  const baseOpacity = clamp(Number(style.opacity) || 1, 0, 1)
  const maxWidthPercent = clamp(Number(style.maxWidthPercent) || 84, 30, 100)
  const offsetX = clamp(Number(style.offsetX) || 0, -600, 600)
  const offsetY = clamp(Number(style.offsetY) || 0, -400, 400)
  const paddingX = clamp(Number(style.paddingX) || 24, 0, 60)
  const paddingY = clamp(Number(style.paddingY) || 12, 0, 40)
  const shadowBlur = clamp(Number(style.shadowBlur) || 0, 0, 24)
  const shadowOffsetX = clamp(Number(style.shadowOffsetX) || 0, -20, 20)
  const shadowOffsetY = clamp(Number(style.shadowOffsetY) || 0, -20, 20)
  const borderRadius = clamp(Number(style.borderRadius) || 18, 0, 40)
  const boxStyle = style.boxStyle === 'none' || style.boxStyle === 'pill' ? style.boxStyle : 'solid'
  const animationDuration = clamp(Number(style.animationDuration) || 0.35, 0.05, 2)
  const animationStrength = clamp(Number(style.animationStrength) || 0.8, 0, 1.5)
  const motionProgress = clamp((currentTime - caption.startTime) / animationDuration, 0, 1)

  const visual: CSSProperties = {
    position: 'absolute',
    maxWidth: `${maxWidthPercent}%`,
    color: style.color || '#ffffff',
    opacity: baseOpacity,
    fontFamily: style.fontFamily || 'Arial, sans-serif',
    fontSize: `${fontSize}px`,
    fontWeight,
    fontStyle: style.italic ? 'italic' : 'normal',
    textDecoration: style.underline ? 'underline' : 'none',
    textTransform: style.textTransform || 'none',
    textAlign: alignment,
    lineHeight,
    letterSpacing: `${letterSpacing}px`,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    textShadow: `${shadowOffsetX}px ${shadowOffsetY}px ${Math.max(shadowBlur, 1)}px ${style.shadowColor || 'rgba(0,0,0,0.65)'}`,
  }

  if (strokeWidth > 0) {
    visual.WebkitTextStroke = `${strokeWidth}px ${style.strokeColor || '#000000'}`
  }

  if (backgroundOpacity > 0 && boxStyle !== 'none') {
    visual.background = hexToRgba(style.backgroundColor || '#000000', backgroundOpacity)
    visual.padding = `${paddingY}px ${paddingX}px`
    visual.borderRadius = boxStyle === 'pill' ? '9999px' : `${borderRadius}px`
  }

  const transforms: string[] = []

  if (alignment === 'left') {
    visual.left = '8%'
  } else if (alignment === 'right') {
    visual.right = '8%'
  } else {
    visual.left = '50%'
    transforms.push('translateX(-50%)')
  }

  if (position === 'top') {
    visual.top = '7%'
  } else if (position === 'center') {
    visual.top = '50%'
    transforms.push('translateY(-50%)')
  } else {
    visual.bottom = '7%'
  }

  if (offsetX !== 0 || offsetY !== 0) {
    transforms.push(`translate(${offsetX}px, ${offsetY}px)`)
  }

  switch (style.animation) {
    case 'fade':
      visual.opacity = baseOpacity * motionProgress
      break
    case 'pop': {
      visual.opacity = baseOpacity * Math.max(motionProgress, 0.2)
      const startScale = 1 - (0.22 * animationStrength)
      const scale = startScale + ((1 - startScale) * motionProgress)
      transforms.push(`scale(${scale.toFixed(3)})`)
      break
    }
    case 'slide-up': {
      visual.opacity = baseOpacity * Math.max(motionProgress, 0.2)
      const distance = 36 * animationStrength * (1 - motionProgress)
      transforms.push(`translateY(${distance.toFixed(1)}px)`)
      break
    }
    case 'slide-down': {
      visual.opacity = baseOpacity * Math.max(motionProgress, 0.2)
      const distance = -36 * animationStrength * (1 - motionProgress)
      transforms.push(`translateY(${distance.toFixed(1)}px)`)
      break
    }
    default:
      break
  }

  if (transforms.length > 0) {
    visual.transform = transforms.join(' ')
  }

  const transformedText = applyTextTransform(caption.text || '', style.textTransform)
  const renderedText = style.animation === 'typewriter'
    ? transformedText.slice(0, Math.max(0, Math.ceil(transformedText.length * motionProgress)))
    : transformedText

  return {
    text: renderedText,
    style: visual,
  }
}
