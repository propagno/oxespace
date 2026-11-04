import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyWithUndo, SettingRow, SettingsSection } from '../src/ui/Settings'
import { Toaster, useToasts } from '../src/ui/Toast'

/** U2 (X3, S-01, S-03): the Settings anatomy, apply-at-once with Undo for the risky list, and toasts inside a modal. */
afterEach(() => { cleanup(); act(() => { useToasts.setState({ items: [] }) }) })

describe('SettingsSection and SettingRow', () => {
  it('a section is a region named by its title, with its actions in the header', () => {
    render(<SettingsSection title="Notifications" description="When OXESpace tells you" actions={<button type="button">Send a test</button>}>
      <SettingRow label="Sound" control={<input type="checkbox" aria-label="Sound" />} />
    </SettingsSection>)
    const section = screen.getByRole('region', { name: 'Notifications' })
    expect(section).toHaveTextContent('When OXESpace tells you')
    expect(section.querySelector('header')).toContainElement(screen.getByRole('button', { name: 'Send a test' }))
  })

  it('htmlFor names the control by the row label; the description sits under it', () => {
    render(<SettingRow label="Workspaces kept open" description="Older ones close" htmlFor="cap" control={<input id="cap" type="number" />} />)
    expect(screen.getByRole('spinbutton', { name: 'Workspaces kept open' })).toBeInTheDocument()
    expect(screen.getByText('Older ones close')).toBeVisible()
  })

  it('wide puts the control under the words', () => {
    const { container } = render(<SettingRow wide label="Shell profiles" control={<ul aria-label="Profiles" />} />)
    expect((container.firstElementChild as HTMLElement).className).toMatch(/wide/)
  })
})

describe('applyWithUndo', () => {
  it('applies, then says what changed with Undo, which runs the undo', async () => {
    const apply = vi.fn(async () => {}), undo = vi.fn(async () => {})
    render(<Toaster />)
    await act(async () => { expect(await applyWithUndo({ apply, undo, done: 'Network access is on' })).toBe(true) })
    expect(apply).toHaveBeenCalledTimes(1)
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(undo).toHaveBeenCalledTimes(1)
  })

  it('a change that fails shows no toast and reports it did not apply', async () => {
    const undo = vi.fn(async () => {})
    let applied = true
    await act(async () => { applied = await applyWithUndo({ apply: async () => { throw new Error('no') }, undo, done: 'Network access is on' }) })
    expect(applied).toBe(false)
    expect(useToasts.getState().items).toEqual([])
  })
})

describe('Toaster inside a modal', () => {
  it('while a modal hosts the stack, the root one steps aside, and comes back when it closes', async () => {
    const { rerender } = render(<><div data-testid="root"><Toaster /></div><div data-testid="modal"><Toaster inModal /></div></>)
    act(() => { useToasts.getState().push({ title: 'Saved' }) })
    await waitFor(() => expect(screen.getByTestId('modal')).toHaveTextContent('Saved'))
    expect(screen.getByTestId('root')).not.toHaveTextContent('Saved')
    rerender(<div data-testid="root"><Toaster /></div>)
    await waitFor(() => expect(screen.getByTestId('root')).toHaveTextContent('Saved'))
  })
})
