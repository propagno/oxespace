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

  it('moves the switch at once and back when the change cannot be saved', async () => {
    let fail: (error: Error) => void = () => {}
    const setProjectEnabled = vi.fn(() => new Promise<never>((_, reject) => { fail = reject }))
    ;(window as { oxe?: unknown }).oxe = { semantic: { projectStatus: vi.fn(async () => ({ on: false, status: status(0) })), setProjectEnabled } }
    render(<ThreadProjectSemantic rootPath="C:/repo" />)
    const box = await screen.findByRole('checkbox', { name: /Index this project/ })
    await vi.waitFor(() => expect(box).not.toBeDisabled())
    fireEvent.click(box)
    expect(box).toBeChecked()
    fail(new Error('This project directory is unavailable'))
    await vi.waitFor(() => expect(box).not.toBeChecked())
    expect(await screen.findByRole('alert')).toHaveTextContent('unavailable')
  })
})
