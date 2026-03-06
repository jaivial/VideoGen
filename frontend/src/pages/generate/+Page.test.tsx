import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockNavigate = vi.fn()
const mockMe = vi.fn()
const mockExtractDocument = vi.fn()

vi.mock('react-router-dom', async () => {
	const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
	return {
		...actual,
		useNavigate: () => mockNavigate,
	}
})

vi.mock('../../api', () => ({
	api: {
		me: (...args: any[]) => mockMe(...args),
		extractDocument: (...args: any[]) => mockExtractDocument(...args),
		generateVideo: vi.fn(),
		getVideoStatus: vi.fn(),
		markDownloaded: vi.fn(),
	},
	connectWebSocket: vi.fn(),
}))

import GeneratePage from './+Page'

describe('GeneratePage Step 1', () => {
	beforeEach(() => {
		mockNavigate.mockReset()
		mockMe.mockReset()
		mockExtractDocument.mockReset()
		mockMe.mockResolvedValue({})
	})

	it('renders transcript tabs for paste and upload input modes', () => {
		render(<GeneratePage />)

		expect(screen.getByRole('button', { name: 'Paste transcript' })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Upload file' })).toBeInTheDocument()
	})

	it('extracts uploaded document text into the transcript textarea', async () => {
		const user = userEvent.setup()
		mockExtractDocument.mockResolvedValue({
			text: 'Extracted transcript from file',
			filename: 'transcript.docx',
			file_type: 'docx',
		})

		render(<GeneratePage />)

		await act(async () => {
			await user.click(screen.getByRole('button', { name: 'Upload file' }))
		})

		const fileInput = screen.getByLabelText(/upload transcript file/i)
		await act(async () => {
			await user.upload(fileInput, new File(['ignored'], 'transcript.docx', {
				type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			}))
		})

		await waitFor(() => {
			expect(mockExtractDocument).toHaveBeenCalledTimes(1)
		})

		await waitFor(() => {
			expect(screen.getByLabelText(/transcript text/i)).toHaveValue('Extracted transcript from file')
		})

		expect(screen.getByText('transcript.docx')).toBeInTheDocument()
	})
})
