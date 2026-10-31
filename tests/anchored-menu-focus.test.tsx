import { act, render, screen } from '@testing-library/react'
import { useState, type ReactElement } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { AnchoredMenu } from '../src/ui'

// A divider's menu hands focus back to the divider when it closes. Reopened right after (keyboard round in
// e2e/drag-alternatives.spec.ts), that late hand-back reached the new menu as "focus outside" and closed it on
// Windows CI. Focus on the menu's own owner never dismisses it; focus anywhere else still does.
function Owner({ onOpenChange }: { onOpenChange: (open: boolean) => void }): ReactElement {
  const [open, setOpen] = useState(true)
  return <>
    <div data-testid="owner" tabIndex={0} style={{ position: 'relative' }}>
      <AnchoredMenu open={open} onOpenChange={next => { onOpenChange(next); setOpen(next) }} label="Divider between columns"
        returnFocus={() => document.querySelector<HTMLElement>('[data-testid="owner"]')} items={[{ label: 'Move the divider left', onSelect: () => {} }]} />
    </div>
    <button type="button">elsewhere</button>
  </>
}

describe('AnchoredMenu and its owner', () => {
  test('focus moving to the owner keeps the menu open', async () => {
    const onOpenChange = vi.fn()
    render(<Owner onOpenChange={onOpenChange} />)
    expect(await screen.findByRole('menu', { name: 'Divider between columns' })).toBeInTheDocument()
    act(() => { screen.getByTestId('owner').focus() })
    expect(screen.getByRole('menu', { name: 'Divider between columns' })).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  test('focus moving anywhere else still closes it', async () => {
    const onOpenChange = vi.fn()
    render(<Owner onOpenChange={onOpenChange} />)
    await screen.findByRole('menu', { name: 'Divider between columns' })
    act(() => { screen.getByRole('button', { name: 'elsewhere' }).focus() })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
