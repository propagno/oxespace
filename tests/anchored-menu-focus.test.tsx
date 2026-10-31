import { act, render, screen, waitFor } from '@testing-library/react'
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
})
