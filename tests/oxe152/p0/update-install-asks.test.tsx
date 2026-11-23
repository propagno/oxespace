// Frozen acceptance test for 1.5.2 P0 (Jira OXE-366; A1, A2). Written by the planner; the executor must not edit it.
// "Restart now" in the update chip and "Restart and install" in Settings both call useUpdaterStore().quitAndInstall.
// Main's quitAndInstallUpdate() bypasses the close guard on purpose, so the window must ask first: the same question as
// File › Exit (src/lib/closeGuard.ts, confirmClose('quit')). No work lost: Cancel installs nothing.
// The real store, the real close guard and the real dialog run here; only main (window.oxe) is replaced.
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { registerUnsavedSource, resetUnsavedSourcesForTests, unsavedWork } from '../../../src/lib/unsavedWork'
import { useUpdaterStore } from '../../../src/store/updater.store'

let install: ReturnType<typeof vi.fn>
let threads: Array<{ id: string; title: string; status: string }>
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 50))
const unsavedFile = (): void => {
  registerUnsavedSource({ id: 'p0-drafts', items: () => [{ id: 'notes.md', label: 'notes.md' }], saveAll: async () => {} })
}
const restartNow = (): Promise<void> => useUpdaterStore.getState().quitAndInstall()

beforeAll(async () => { await import('../../../src/components/CloseGuard/UnsavedWorkDialog') }, 30_000)
beforeEach(() => {
  resetUnsavedSourcesForTests()
  install = vi.fn(async () => true)
  threads = []
  window.oxe = { app: { quitAndInstall: install }, thread: { list: vi.fn(async () => threads) } } as never
})
afterEach(async () => {
  // Whatever question is still open is answered, so the shared confirmation never leaks into the next test.
  const dialog = screen.queryByTestId('unsaved-work-dialog')
  if (dialog) fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await settle()
  cleanup()
})

describe('OXE-366 · an update restart never loses work', () => {
  test('Restart and install with unsaved work asks first, and Cancel installs nothing and keeps the work', async () => {
    unsavedFile()
    const pending = restartNow()
    await settle()
    expect(install, 'nothing installs before the person answers').not.toHaveBeenCalled()
    expect(await screen.findByTestId('unsaved-work-dialog')).toHaveTextContent('notes.md')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await pending
    expect(install).not.toHaveBeenCalled()
    expect(unsavedWork()).toHaveLength(1)
  })

  test('Restart and install with an agent turn in progress names the conversation, and Cancel keeps it running', async () => {
    threads = [{ id: 't1', title: 'Migrate the billing table', status: 'running' }]
    const pending = restartNow()
    await settle()
    expect(install, 'nothing installs before the person answers').not.toHaveBeenCalled()
    expect(await screen.findByTestId('running-turns-list')).toHaveTextContent('Migrate the billing table')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await pending
    expect(install).not.toHaveBeenCalled()
  })

  test('Restart and install waits for an approval in progress too', async () => {
    threads = [{ id: 't2', title: 'Publish the package', status: 'approval' }]
    const pending = restartNow()
    await settle()
    expect(install, 'a turn waiting for the person is still a turn').not.toHaveBeenCalled()
    expect(await screen.findByTestId('running-turns-list')).toHaveTextContent('Publish the package')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await pending
    expect(install).not.toHaveBeenCalled()
  })

  test('confirming installs exactly once, also after two clicks while the question was open', async () => {
    unsavedFile()
    const first = restartNow()
    const second = restartNow()
    await settle()
    expect(install, 'nothing installs before the person answers').not.toHaveBeenCalled()
    fireEvent.click(await screen.findByTestId('unsaved-work-discard'))
    await Promise.all([first, second])
    await waitFor(() => expect(install).toHaveBeenCalledTimes(1))
  })

  test('with nothing to lose Restart and install goes on without a question', async () => {
    await restartNow()
    expect(install).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('unsaved-work-dialog')).toBeNull()
  })
})
