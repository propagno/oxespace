import { act, render, screen, waitFor, within } from '@testing-library/react'
import { useImperativeHandle, useState, forwardRef, type ReactElement } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { AnchoredMenu } from '../src/ui'

// A divider's menu hands focus back to the divider when it closes. Reopened right after (keyboard round in
// e2e/drag-alternatives.spec.ts), that late hand-back reached the new menu as "focus outside" and closed it on
// Windows CI. Focus on the menu's own owner never dismisses it; focus anywhere else still does.
const Owner = forwardRef<{ setOpen: (open: boolean) => void }, { onOpenChange: (open: boolean) => void }>(function Owner({ onOpenChange }, ref): ReactElement {
  const [open, setOpen] = useState(true)
  useImperativeHandle(ref, () => ({ setOpen }), [])
  return <>
    <div data-testid="owner" tabIndex={0} style={{ position: 'relative' }}>
      <AnchoredMenu open={open} onOpenChange={next => { onOpenChange(next); setOpen(next) }} label="Divider between columns"
        returnFocus={() => document.querySelector<HTMLElement>('[data-testid="owner"]')} items={[{ label: 'Move the divider left', onSelect: () => {} }]} />
    </div>
    <button type="button">elsewhere</button>
  </>
})

describe('AnchoredMenu and its owner', () => {
  test('focus moving to the owner keeps the menu open and puts the keyboard on its first item', async () => {
    const onOpenChange = vi.fn()
    render(<Owner onOpenChange={onOpenChange} />)
    expect(await screen.findByRole('menu', { name: 'Divider between columns' })).toBeInTheDocument()
    act(() => { screen.getByTestId('owner').focus() })
    expect(screen.getByRole('menu', { name: 'Divider between columns' })).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Move the divider left' })).toHaveFocus())
  })

  test('the close → reopen race: the late focus hand-back leaves the reopened menu open, with a menuitem focused', async () => {
    // What drag-alternatives does on CI: Escape closes the first menu, the keyboard reopens it at once, and the first
    // menu's onCloseAutoFocus still hands focus to the divider after the second one is up.
    const onOpenChange = vi.fn()
    const owner = { current: null as { setOpen: (open: boolean) => void } | null }
    render(<Owner ref={owner} onOpenChange={onOpenChange} />)
    await screen.findByRole('menu', { name: 'Divider between columns' })
    act(() => { owner.current!.setOpen(false) })
    act(() => { owner.current!.setOpen(true) })
    expect(await screen.findByRole('menu', { name: 'Divider between columns' })).toBeInTheDocument()
    act(() => { screen.getByTestId('owner').focus() })
    expect(screen.getByRole('menu', { name: 'Divider between columns' })).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Move the divider left' })).toHaveFocus())
  })

  test('focus moving anywhere else still closes it', async () => {
    const onOpenChange = vi.fn()
    render(<Owner onOpenChange={onOpenChange} />)
    await screen.findByRole('menu', { name: 'Divider between columns' })
    act(() => { screen.getByRole('button', { name: 'elsewhere' }).focus() })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  test('the keyboard skips a disabled first item (a Splitter at its minimum has "Smaller" disabled)', async () => {
    render(<div tabIndex={0} style={{ position: 'relative' }}><AnchoredMenu open onOpenChange={() => {}} label="Sidebar width: size options"
      items={[{ label: 'Smaller', onSelect: () => {}, disabled: true }, { label: 'Larger', onSelect: () => {} }]} /></div>)
    await screen.findByRole('menu', { name: 'Sidebar width: size options' })
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Larger' })).toHaveFocus())
  })
})

import { describe as describeDialog } from 'vitest'
describeDialog('a dialog opened from a menu item', () => {
  test('keeps its focus when the menu closes; a plain item still gives focus back to the trigger', async () => {
    const { Menu, ConfirmDialog } = await import('../src/ui')
    const { useState } = await import('react')
    const userEvent = (await import('@testing-library/user-event')).default
    function Host() {
      const [open, setOpen] = useState(false)
      return <>
        <Menu label="Actions" trigger={<button type="button">More</button>} items={[
          { label: 'Archive…', onSelect: () => setOpen(true) },
          { label: 'Pin', onSelect: () => undefined }
        ]} />
        {open && <ConfirmDialog title="Archive this?" description="It goes to Archived." confirmLabel="Archive" onConfirm={() => setOpen(false)} onCancel={() => setOpen(false)} />}
      </>
    }
    const user = userEvent.setup()
    render(<Host />)
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(screen.getByRole('menuitem', { name: 'Archive…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Archive this?' })
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus())
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'More' }))
    await user.click(screen.getByRole('menuitem', { name: 'Pin' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'More' })).toHaveFocus())
  })
})
