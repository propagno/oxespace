// Frozen acceptance test for CR-01 (OXE phase F1, A6, from the FRONTEND review of #607). The executor must not edit it.
// A menu item with a hint keeps the label as its accessible name, gives the hint as its description, types ahead on the
// label (textValue, checked in review), and no group heading is left without an item after the destructive ones move to the end.
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { AnchoredMenu, type MenuEntry } from '../../../src/ui'

const noop = (): void => undefined

function open(items: MenuEntry[]): void {
  render(<div><AnchoredMenu open onOpenChange={noop} label="Pane actions" items={items} /></div>)
}

describe('CR-01 · menu hint accessibility (U7)', () => {
  test('the hint is the item description, not part of or hidden by its name', async () => {
    open([{ label: 'Caveman', hint: 'Shorter answers, fewer tokens', onSelect: noop }])
    const item = await screen.findByRole('menuitem', { name: 'Caveman' })
    expect(item).not.toHaveAttribute('aria-label')
    expect(item).toHaveAccessibleDescription('Shorter answers, fewer tokens')
  })

  test('a group heading with no safe item after it is dropped when its destructive items move to the end', async () => {
    open([
      { label: 'Rename', onSelect: noop },
      { type: 'label', label: 'Danger zone' },
      { label: 'Delete', onSelect: noop, danger: true }
    ])
    await screen.findByRole('menuitem', { name: 'Rename' })
    expect(screen.queryByText('Danger zone')).toBeNull()
    const names = screen.getAllByRole('menuitem').map(element => element.textContent)
    expect(names).toEqual(['Rename', 'Delete'])
  })
})
