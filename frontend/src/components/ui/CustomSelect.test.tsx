import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CustomSelect } from './CustomSelect'

describe('CustomSelect', () => {
  it('renders a custom listbox-style selector and updates the value', () => {
    const handleChange = vi.fn()

    render(
      <CustomSelect
        id="quality"
        label="Quality"
        value="medium"
        onChange={handleChange}
        options={[
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
        ]}
      />,
    )

    const trigger = screen.getByRole('combobox', { name: /quality/i })
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox')
    expect(document.querySelector('select')).not.toBeInTheDocument()

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('option', { name: 'High' }))

    expect(handleChange).toHaveBeenCalledWith('high')
  })
})
