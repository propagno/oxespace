// Frozen acceptance test for 1.5.2 Polimento · Componentes base (Jira OXE-198, PB-01·7, CA-1 to CA-3). Written by the
// planner; the executor must not edit it. Item: oxespace-ux-ag/POLISH-01-componentes-base.md #7, approved by MARCA
// (400 ms, keyboard focus opens, Escape closes).
// Contract (src/ui/TitleTooltips.tsx): an element with a native title that receives keyboard focus (Tab) shows the
// styled hint (role="tooltip", the title's text) 400 ms later, as the pointer does: not before 400 ms, shown by 410 ms.
// Escape or focus leaving the element closes it and puts the title back. The pointer delay is 400 ms too (it was 450).
// Pointer behaviour otherwise unchanged (tests/ui-title-tooltips.test.tsx). Here keyboard focus is a Tab keydown, then
// focus (focusin), then the keyup, as a browser delivers it; :focus-visible is not relied on (jsdom). The built app:
// pb-01-7.spec.ts.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { TitleTooltips } from '../../../src/ui/TitleTooltips'
// ---- repository text and catalog strings (inlined in each frozen file so every task's PR stands alone) ----
import { readFileSync as pbReadFile } from 'node:fs'
import { join as pbJoin } from 'node:path'

const pbRead = (rel: string): string => pbReadFile(pbJoin(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')
const pbCatalogs: Record<string, unknown> = {}
/** The English catalog text of `ns:key` (shared/locales/en/<ns>.json), so elements are found by what a person reads. */
function cat(ns: string, key: string, vars: Record<string, string | number> = {}): string {
  pbCatalogs[ns] ??= JSON.parse(pbRead(`shared/locales/en/${ns}.json`))
  let node: unknown = pbCatalogs[ns]
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  if (typeof node !== 'string') throw new Error(`the en ${ns} catalog has no key ${key}`)
  return node.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars[name] ?? `{{${name}}}`))
}
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers() })
const wait = (ms: number): void => { act(() => { vi.advanceTimersByTime(ms) }) }
/** Tab (or Shift+Tab) to `target` as the keyboard does: the key goes down where focus is, focus moves, the key comes up. */
function tabTo(target: HTMLElement, shift = false): void {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', code: 'Tab', shiftKey: shift })
  act(() => { target.focus() })
  fireEvent.keyUp(target, { key: 'Tab', code: 'Tab', shiftKey: shift })
}
const press = (key: string): void => { fireEvent.keyDown(document.activeElement ?? document.body, { key, code: key }); fireEvent.keyUp(document.activeElement ?? document.body, { key, code: key }) }

describe('PB-01·7 · TitleTooltips on keyboard focus, 400 ms, Escape', () => {
  test('Tab to an element with a title shows its hint after 400 ms, not before', () => {
    render(<><TitleTooltips /><button type="button" title="Open settings">Gear</button></>)
    tabTo(screen.getByText('Gear'))
    expect(screen.getByText('Gear')).toHaveFocus()
    wait(380)
    expect(screen.queryByRole('tooltip')).toBeNull()
    wait(30)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Open settings')
  })

  test('Escape closes the focus hint and puts the title back; so does focus leaving', () => {
    render(<><TitleTooltips /><button type="button" title="Open settings">Gear</button><button type="button">Next</button></>)
    tabTo(screen.getByText('Gear'))
    wait(410)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Open settings')
    press('Escape')
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(screen.getByText('Gear')).toHaveAttribute('title', 'Open settings')
    tabTo(screen.getByText('Next'))
    tabTo(screen.getByText('Gear'), true)
    expect(screen.getByText('Gear')).toHaveFocus()
    wait(410)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Open settings')
    tabTo(screen.getByText('Next'))
    expect(screen.getByText('Next')).toHaveFocus()
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(screen.getByText('Gear')).toHaveAttribute('title', 'Open settings')
  })

  test('under the pointer the delay is 400 ms too', () => {
    render(<><TitleTooltips /><button type="button" title="Split pane">Split</button></>)
    fireEvent.pointerOver(screen.getByText('Split'))
    wait(380)
    expect(screen.queryByRole('tooltip')).toBeNull()
    wait(30)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Split pane')
  })
})
