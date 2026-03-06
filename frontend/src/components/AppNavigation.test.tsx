import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppNavigation } from './AppNavigation'

const colors = {
  bg: '#111111',
  card: '#181818',
  text: '#ffffff',
  textSecondary: '#999999',
  primary: '#2563eb',
  border: '#2a2a2a',
}

describe('AppNavigation', () => {
  it('renders the editor tab pointing to the blank editor workspace', () => {
    render(
      <AppNavigation
        colors={colors}
        darkMode={false}
        activeTab="editor"
        onToggleDarkMode={vi.fn()}
      />,
    )

    const editorLink = screen.getByRole('link', { name: 'Editor' })
    expect(editorLink).toHaveAttribute('href', '/editor')
    expect(editorLink).toHaveStyle(`background-color: ${colors.primary}`)
  })

  it('calls the dark mode handler when the theme button is clicked', () => {
    const onToggleDarkMode = vi.fn()

    render(
      <AppNavigation
        colors={colors}
        darkMode={false}
        activeTab="generate"
        onToggleDarkMode={onToggleDarkMode}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /toggle dark mode/i }))
    expect(onToggleDarkMode).toHaveBeenCalledTimes(1)
  })
})
