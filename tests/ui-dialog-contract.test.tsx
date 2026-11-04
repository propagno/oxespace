import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from '../src/ui/ConfirmDialog'
import { Dialog } from '../src/ui/Overlay'

/**
 * U1 (X1, D-01, D-02, D-04): one contract for every dialog. The footer is extra · Cancel · primary, in that order;
 * focus starts on the first field, else on Cancel (the safe action), never on the close button; Enter in a
 * single-line field runs the primary; a ConfirmDialog can ask for "I understand…" before its action runs.
 */
afterEach(cleanup)
const noop = (): void => undefined

describe('Dialog footer slots', () => {
  it('lays out extra, Cancel and the primary in that order', () => {
    render(<Dialog size="md" title="New connection" onClose={noop}
      actions={{ extra: <button type="button">Test</button>, primary: { label: 'Save', onClick: noop } }}>
      <p>Body</p>
    </Dialog>)
    const footer = screen.getByRole('dialog').querySelector('[data-dialog-footer]')!
    expect([...footer.querySelectorAll('button')].map(button => button.textContent)).toEqual(['Test', 'Cancel', 'Save'])
  })

  it('Cancel says "Cancel" and closes, unless the dialog gives it its own words and action', () => {
    const onClose = vi.fn()
    const { unmount } = render(<Dialog size="sm" title="Rename" onClose={onClose} actions={{ primary: { label: 'Rename', onClick: noop } }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount()
    const onCancel = vi.fn()
    render(<Dialog size="sm" title="Unsaved work" onClose={onClose} actions={{ cancel: { label: 'Keep editing', onClick: onCancel } }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a danger primary is a danger button', () => {
    render(<Dialog size="sm" title="Delete" onClose={noop} actions={{ primary: { label: 'Delete', danger: true, onClick: noop } }} />)
    const primary = screen.getByRole('button', { name: 'Delete' })
    expect(primary).toHaveAttribute('data-dialog-primary')
    expect(primary.className).toMatch(/danger/)
  })
})

describe('Dialog initial focus with the slots', () => {
  it('starts on the first field', async () => {
    render(<Dialog size="md" title="Rename" onClose={noop} actions={{ extra: <button type="button">Help</button>, primary: { label: 'Save', onClick: noop } }}>
      <input aria-label="Name" />
    </Dialog>)
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveFocus())
  })

  it('starts on Cancel when there is no field, not on an extra action that comes first', async () => {
    render(<Dialog size="md" title="Report a problem" onClose={noop} actions={{ extra: <button type="button">Copy text</button>, primary: { label: 'Send', onClick: noop } }}>
      <p>What happened</p>
    </Dialog>)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
    expect(screen.getByRole('button', { name: 'Close' })).not.toHaveFocus()
  })
})

describe('Enter in a field runs the primary', () => {
  const setup = (primary: { disabled?: boolean } = {}) => {
    const onClick = vi.fn()
    render(<Dialog size="md" title="Rename" onClose={noop} actions={{ primary: { label: 'Save', onClick, ...primary } }}>
      <input aria-label="Name" />
      <textarea aria-label="Notes" />
      <input aria-label="Agree" type="checkbox" />
      <input aria-label="Search" role="combobox" aria-expanded="true" />
    </Dialog>)
    return onClick
  }

  it('from a single-line field', () => {
    const onClick = setup()
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('not from a text area, a checkbox, an open combobox, or with a modifier', () => {
    const onClick = setup()
    fireEvent.keyDown(screen.getByLabelText('Notes'), { key: 'Enter' })
    fireEvent.keyDown(screen.getByLabelText('Agree'), { key: 'Enter' })
    fireEvent.keyDown(screen.getByLabelText('Search'), { key: 'Enter' })
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter', shiftKey: true })
    expect(onClick).not.toHaveBeenCalled()
  })

  it('not while the primary is disabled', () => {
    const onClick = setup({ disabled: true })
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter' })
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('ConfirmDialog', () => {
  it('starts on Cancel and keeps its order: Cancel, then the action', async () => {
    render(<ConfirmDialog title="Archive this conversation?" description="It leaves the list." confirmLabel="Archive" onConfirm={noop} onCancel={noop} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
    const footer = screen.getByRole('dialog').querySelector('[data-dialog-footer]')!
    expect([...footer.querySelectorAll('button')].map(button => button.textContent)).toEqual(['Cancel', 'Archive'])
  })

  it('"I understand…" gates the action, and Cancel still starts focused', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmDialog title="Remove the volume?" description="Its data is deleted." confirmLabel="Approve" danger
      acknowledge="I understand this can't be undone" onConfirm={onConfirm} onCancel={noop} />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())
    const approve = screen.getByRole('button', { name: 'Approve' })
    expect(approve).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: "I understand this can't be undone" }))
    expect(approve).toBeEnabled()
    fireEvent.click(approve)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('while busy, Cancel keeps focus and says it is unavailable, and closing does nothing', async () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog title="Delete?" description="Gone for good." confirmLabel="Delete" busy onConfirm={noop} onCancel={onCancel} />)
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    await waitFor(() => expect(cancel).toHaveFocus())
    expect(cancel).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(cancel)
    fireEvent.keyDown(cancel, { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
  })
})
