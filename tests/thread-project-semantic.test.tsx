import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThreadProjectSemantic } from '../src/components/Threads/ThreadProjectSemantic'

afterEach(() => { cleanup(); delete (window as { oxe?: unknown }).oxe })
const status = (files: number, indexing = false) => ({ enabled: files > 0, workerReady: false, indexing, count: 0, lastError: null, mode: 'auto', coverage: { lexicalDocuments: files }, lastQuery: null })

describe('Thread project semantic search', () => {
  it('is off until the person turns it on, then shows the index', async () => {
    const setProjectEnabled = vi.fn(async () => ({ on: true, status: status(240) }))
    ;(window as { oxe?: unknown }).oxe = { semantic: { projectStatus: vi.fn(async () => ({ on: false, status: status(0) })), setProjectEnabled } }
    render(<ThreadProjectSemantic rootPath="C:/repo" />)
    const box = await screen.findByRole('checkbox', { name: /Index this project/ })
    await vi.waitFor(() => expect(box).not.toBeDisabled())
    expect(box).not.toBeChecked()
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(box)
    expect(await screen.findByRole('status')).toHaveTextContent('240 files indexed')
    expect(setProjectEnabled).toHaveBeenCalledWith({ rootPath: 'C:/repo', enabled: true })
  })
})
