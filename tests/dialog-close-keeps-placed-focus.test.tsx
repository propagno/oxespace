import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { useState, type ReactElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { Dialog } from '../src/ui/Overlay'

/**
 * OXE-103 (thread-worktree.spec.ts): focus returns to the opener after a dialog closes, unless something else already
 * took it. Radix returns focus a tick after the close; taking it back then sent a key typed into the composer to the
 * button that opened the dialog.
 */
afterEach(cleanup)

function Harness({ focusAfterClose }: { focusAfterClose: boolean }): ReactElement {
  const [open, setOpen] = useState(false)
  const close = (): void => {
    setOpen(false)
    if (focusAfterClose) queueMicrotask(() => document.querySelector<HTMLTextAreaElement>('textarea')?.focus())
  }
  return <>
    <button type="button" onClick={() => setOpen(true)}>Open</button>
    <textarea aria-label="Composer" />
    {open && <Dialog title="Worktree" onClose={close} footer={<button type="button" onClick={close}>Cancel</button>}><p>Body</p></Dialog>}
  </>
}

const flush = (): Promise<void> => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })

describe('Dialog close focus', () => {
  it('leaves focus where it was placed after the close', async () => {
    render(<Harness focusAfterClose />)
    screen.getByRole('button', { name: 'Open' }).focus()
    await act(async () => { screen.getByRole('button', { name: 'Open' }).click() })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
    await act(async () => { screen.getByRole('button', { name: 'Cancel' }).click() })
    await flush()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByLabelText('Composer')).toHaveFocus()
  })

  it('returns focus to the opener when nothing took it', async () => {
    render(<Harness focusAfterClose={false} />)
    screen.getByRole('button', { name: 'Open' }).focus()
    await act(async () => { screen.getByRole('button', { name: 'Open' }).click() })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
    await act(async () => { screen.getByRole('button', { name: 'Cancel' }).click() })
    await flush()
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus()
  })
})
