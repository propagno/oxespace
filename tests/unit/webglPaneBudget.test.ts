import { describe, expect, test, vi } from 'vitest'
import { WebglPaneBudget } from '../../src/components/Terminal/webglBudget'
import type { TerminalPresence } from '../../shared/types/ipc/terminal'

function setup(limit: number) {
  const budget = new WebglPaneBudget(limit)
  const events: string[] = []
  const releases = new Map<string, () => void>()
  const join = (paneId: string, presence: TerminalPresence): void => {
    releases.set(paneId, budget.join(paneId, presence, granted => events.push(`${paneId}:${granted ? 'on' : 'off'}`)))
  }
  const holders = (...ids: string[]): string[] => ids.filter(id => budget.granted(id))
  return { budget, events, join, release: (id: string) => releases.get(id)?.(), holders }
}

describe('WebglPaneBudget (F16)', () => {
  test('visible panes take free slots up to the limit; the rest stay on the DOM renderer', () => {
    const { join, holders } = setup(2)
    join('a', 'visible'); join('b', 'visible'); join('c', 'visible')
    expect(holders('a', 'b', 'c')).toEqual(['a', 'b'])
  })

  test('the focused pane gets WebGL first, taking the slot of the pane focused longest ago', () => {
    const { budget, join, holders, events } = setup(2)
    join('a', 'focused')
    budget.setPresence('a', 'visible')
    join('b', 'focused')
    budget.setPresence('b', 'visible')
    join('c', 'focused')
    // a was focused before b, so it gives its slot to c; the revoke comes before the grant.
    expect(holders('a', 'b', 'c')).toEqual(['b', 'c'])
    expect(events.slice(-2)).toEqual(['a:off', 'c:on'])
  })

  test('moving focus between panes that already hold WebGL switches no renderer', () => {
    const { budget, join, events } = setup(3)
    join('a', 'focused'); join('b', 'visible'); join('c', 'visible')
    const before = events.length
    budget.setPresence('a', 'visible')
    budget.setPresence('c', 'focused')
    expect(events.length).toBe(before)
  })

  test('a hidden pane gives its slot back, and the most recently focused waiting pane takes it', () => {
    const { budget, join, holders } = setup(1)
    join('a', 'visible')
    join('b', 'visible')
    expect(holders('a', 'b')).toEqual(['a'])
    budget.setPresence('a', 'hidden')
    expect(holders('a', 'b')).toEqual(['b'])
    // Shown again, it waits: b keeps its slot until a focused pane needs one.
    budget.setPresence('a', 'visible')
    expect(holders('a', 'b')).toEqual(['b'])
    budget.setPresence('a', 'focused')
    expect(holders('a', 'b')).toEqual(['a'])
  })

  test('a hidden pane never takes WebGL, even when slots are free', () => {
    const { join, holders, events } = setup(4)
    join('a', 'hidden')
    expect(holders('a')).toEqual([])
    expect(events).toEqual([])
  })

  test('unmount releases the slot to a waiting pane; a release twice is harmless', () => {
    const { join, release, holders, events } = setup(1)
    join('a', 'focused'); join('b', 'visible')
    release('a')
    expect(holders('a', 'b')).toEqual(['b'])
    expect(events).toEqual(['a:on', 'a:off', 'b:on'])
    release('a')
    expect(events).toHaveLength(3)
  })

  test('a budget of zero keeps every pane on the DOM renderer', () => {
    const { join, holders } = setup(0)
    join('a', 'focused')
    expect(holders('a')).toEqual([])
  })

  test('a focused pane never evicts another focused pane', () => {
    const { join, holders } = setup(1)
    join('a', 'focused'); join('b', 'focused')
    expect(holders('a', 'b')).toEqual(['a'])
  })

  test('the default budget comes from localStorage when set, for the bench', async () => {
    localStorage.setItem('oxe.terminal.webglPanes', '1')
    vi.resetModules()
    const { WebglPaneBudget: Fresh } = await import('../../src/components/Terminal/webglBudget')
    const budget = new Fresh()
    budget.join('a', 'visible', () => undefined)
    budget.join('b', 'visible', () => undefined)
    expect([budget.granted('a'), budget.granted('b')]).toEqual([true, false])
    localStorage.removeItem('oxe.terminal.webglPanes')
  })
})
