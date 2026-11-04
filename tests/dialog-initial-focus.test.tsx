import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Dialog } from '../src/ui/Overlay'

/**
 * D-01 (DESIGN audit #568): every dialog starts in the same place. A child's own choice wins, else the first field of
 * the body, else the first footer button, else the dialog itself; never the close button.
 */
afterEach(cleanup)

const noop = (): void => undefined

describe('Dialog initial focus', () => {
  it('starts on the first field of the body, skipping a disabled one', async () => {
    render(<Dialog title="Rename" onClose={noop} footer={<button type="button">Save</button>}>
      <p>Some text</p>
      <input aria-label="Disabled" disabled />
      <input aria-label="Name" />
      <input aria-label="Other" />
    </Dialog>)
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveFocus())
  })

  it('starts on the first footer button when the body has no field', async () => {
    render(<Dialog title="Report a problem" onClose={noop} footer={<><button type="button" disabled>Disabled</button><button type="button">Copy text</button><button type="button">Open on GitHub</button></>}>
      <p>What happened</p>
    </Dialog>)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy text' })).toHaveFocus())
    expect(screen.getByRole('button', { name: 'Close' })).not.toHaveFocus()
  })

  it('starts on the dialog itself when it has neither, never on Close', async () => {
    render(<Dialog title="About" onClose={noop}><p>Version 1.4.1</p></Dialog>)
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'About' })).toHaveFocus())
  })

  it('keeps the focus a child chose', async () => {
    render(<Dialog title="Delete" onClose={noop} footer={<button type="button">Delete</button>}>
      <input aria-label="Name" />
      <button type="button" autoFocus>Keep it</button>
    </Dialog>)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Keep it' })).toHaveFocus())
  })
})
