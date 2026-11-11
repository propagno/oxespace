import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CloseAnswerInput, CloseRequest } from '../shared/types/app'
import { handleCloseRequest, installCloseGuard } from '../src/lib/closeGuard'
import { registerUnsavedSource, resetUnsavedSourcesForTests, unsavedWork } from '../src/lib/unsavedWork'

const answers: Array<CloseAnswerInput['answer']> = []
let writeFile: ReturnType<typeof vi.fn>
type DraftItem = { relativePath: string; content: string }

function editedFile(relativePath: string, content = 'changed'): DraftItem {
  return { relativePath, content }
}
let drafts: DraftItem[] = []
function setFiles(...files: DraftItem[]): void {
  drafts = [...files]
  registerUnsavedSource({
    id: 'test-drafts',
    items: () => drafts.map(file => ({ id: file.relativePath, label: file.relativePath, detail: 'OxeQuery · demo' })),
    saveAll: async () => {
      const remaining: DraftItem[] = []
      for (const file of drafts) {
        try { await writeFile({ relativePath: file.relativePath, content: file.content }) }
        catch { remaining.push(file) }
      }
      drafts = remaining
    }
  })
}
const request = (requestId: string, reason: CloseRequest['reason'] = 'close'): Promise<void> => handleCloseRequest({ requestId, reason })

// The dialog is its own chunk; load it once so the first test does not wait on the import.
beforeAll(async () => { await import('../src/components/CloseGuard/UnsavedWorkDialog') }, 30_000)
beforeEach(() => {
  answers.length = 0
  drafts = []
  resetUnsavedSourcesForTests()
  writeFile = vi.fn(async () => undefined)
  window.oxe = { ...window.oxe, app: { ...(window.oxe?.app ?? {}), answerClose: vi.fn(async (input: CloseAnswerInput) => { answers.push(input.answer) }) }, fs: { ...(window.oxe?.fs ?? {}) } } as unknown as typeof window.oxe
})
// A dialog unmounts just after it answers; wait for it so the next test cannot click a stale one.
afterEach(async () => { cleanup(); resetUnsavedSourcesForTests(); await waitFor(() => expect(screen.queryByTestId('unsaved-work-dialog')).toBeNull()) })

describe('close guard', () => {
  it('closes at once when nothing is unsaved', async () => {
    await request('r1')
    expect(answers).toEqual(['proceed'])
    expect(screen.queryByTestId('unsaved-work-dialog')).toBeNull()
  })

  it('holds first, lists what would be lost with Cancel focused, and Cancel keeps the window open', async () => {
    setFiles(editedFile('notes.md'), editedFile('src/app.ts'))
    const pending = request('r2')
    const dialog = await screen.findByTestId('unsaved-work-dialog')
    expect(answers).toEqual(['hold'])
    expect(dialog).toHaveTextContent('Save your changes before closing?')
    expect(dialog).toHaveTextContent('2 changes are not saved yet')
    expect(dialog).toHaveTextContent('notes.md')
    expect(dialog).toHaveTextContent('OxeQuery · demo')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await pending
    expect(answers).toEqual(['hold', 'cancel'])
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('a quit says so, and "Quit without saving" goes on without writing anything', async () => {
    setFiles(editedFile('notes.md'))
    const pending = request('r3', 'quit')
    expect(await screen.findByRole('heading', { name: 'Save your changes before quitting?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Quit without saving' }))
    await pending
    expect(answers).toEqual(['hold', 'proceed'])
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('"Save all and close" writes every edited file, active or not, then closes', async () => {
    setFiles(editedFile('notes.md', 'one'), editedFile('src/app.ts', 'two'))
    const pending = request('r4')
    fireEvent.click(await screen.findByRole('button', { name: 'Save all and close' }))
    await pending
    expect(writeFile.mock.calls.map(([input]) => [input.relativePath, input.content])).toEqual([['notes.md', 'one'], ['src/app.ts', 'two']])
    expect(unsavedWork()).toEqual([])
    expect(answers).toEqual(['hold', 'proceed'])
  })

  it('a save that fails keeps the window open and says what is left', async () => {
    setFiles(editedFile('notes.md'))
    writeFile.mockRejectedValueOnce(new Error('disk full'))
    const pending = request('r5')
    fireEvent.click(await screen.findByRole('button', { name: 'Save all and close' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('1 change could not be saved, so nothing was closed')
    expect(answers).toEqual(['hold'])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await pending
    expect(answers).toEqual(['hold', 'cancel'])
  })

  it('a save that only partly works keeps holding, lists only what is left, and leaves the choice to the person', async () => {
    setFiles(editedFile('notes.md', 'one'), editedFile('src/app.ts', 'two'))
    writeFile.mockImplementation(async (input: { relativePath: string }) => { if (input.relativePath === 'src/app.ts') throw new Error('locked') })
    const pending = request('r8')
    fireEvent.click(await screen.findByRole('button', { name: 'Save all and close' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('1 change could not be saved')
    const dialog = screen.getByTestId('unsaved-work-dialog')
    expect(dialog).toHaveTextContent('src/app.ts')
    expect(dialog).not.toHaveTextContent('notes.md')
    // Still held: nothing is answered for the person.
    expect(answers).toEqual(['hold'])
    fireEvent.click(screen.getByRole('button', { name: 'Close without saving' }))
    await pending
    expect(answers).toEqual(['hold', 'proceed'])
  })

  it('a request already being asked about is not asked twice', async () => {
    setFiles(editedFile('notes.md'))
    const first = request('r6')
    await screen.findByTestId('unsaved-work-dialog')
    await request('r6')
    expect(screen.getAllByTestId('unsaved-work-dialog')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await first
    expect(answers).toEqual(['hold', 'cancel'])
  })

  it('subscribes at start and answers through the bridge', async () => {
    let listener: ((request: CloseRequest) => void) | undefined
    const unsubscribe = vi.fn()
    window.oxe = { ...window.oxe, app: { ...window.oxe.app, onCloseRequested: vi.fn((next: (request: CloseRequest) => void) => { listener = next; return unsubscribe }) } } as unknown as typeof window.oxe
    const uninstall = installCloseGuard()
    act(() => listener!({ requestId: 'r7', reason: 'close' }))
    await waitFor(() => expect(answers).toEqual(['proceed']))
    uninstall()
    expect(unsubscribe).toHaveBeenCalled()
  })
})

describe('unsaved work registry', () => {
  it('a source that throws while listing counts as nothing, and removing it forgets it', () => {
    const remove = registerUnsavedSource({ id: 'broken', items: () => { throw new Error('x') }, saveAll: async () => undefined })
    expect(unsavedWork().some(entry => entry.source === 'broken')).toBe(false)
    remove()
    const removeOther = registerUnsavedSource({ id: 'drafts', items: () => [{ id: 'd1', label: 'Draft' }], saveAll: async () => undefined })
    expect(unsavedWork().find(entry => entry.source === 'drafts')?.items).toEqual([{ id: 'd1', label: 'Draft' }])
    removeOther()
    expect(unsavedWork().some(entry => entry.source === 'drafts')).toBe(false)
  })
})
