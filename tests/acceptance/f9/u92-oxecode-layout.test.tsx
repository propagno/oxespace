// Frozen acceptance test for 1.5.0 A33 on screen (DESIGN U9.2, OXE program, phase F9, task FE-A33). Written by the
// planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f9-design.md (U9.2).
// Window only. The renderer parts:
// - reportSplitTooSmall(size: { width, height }) in src/components/Grid/splitRefusal.ts (now with the sizes the halves
//   would get);
// - paneOverflowNote(panes, width) in src/components/Grid/paneOverflow.ts: the one-at-a-time note at 900 px past 4 panes;
// - clampDockWidth(width, windowWidth) in src/components/Workbench/dockWidth.ts: 320–900, capped at 420 when the window is
//   900 wide or less.
// U9.2a (presets, dividers, split rules and Focus at 1440 and 900, oxecode-layout.spec), U9.2b (no sideways overflow at
// 900 with the dock) and U9.2c (panes stay mounted across Focus tabs) are the e2e run.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}

afterEach(async () => { cleanup(); await changeLanguage('en') })

describe('U9.2 · OxeCode layout', () => {
  test('a split with no room says the size the panes would get, against 240 × 120', async () => {
    const { Toaster } = await import('../../../src/ui/Toast')
    render(<Toaster />)
    const { reportSplitTooSmall } = await import('../../../src/components/Grid/splitRefusal') as unknown as { reportSplitTooSmall: (size: { width: number; height: number }) => void }
    act(() => reportSplitTooSmall({ width: 180, height: 300 }))
    expect(await screen.findByText('No room to split: panes would be 180 × 300 px, under 240 × 120.')).toBeInTheDocument()
  })

  test('at 900 px past four panes they show one at a time, and the note says how many', async () => {
    const { paneOverflowNote } = await load<{ paneOverflowNote: (panes: number, width: number) => string | null }>('src/components/Grid/paneOverflow')
    expect(paneOverflowNote(6, 900)).toBe("6 panes don't fit at this width, so they show one at a time.")
    expect(paneOverflowNote(4, 900)).toBeNull()
    expect(paneOverflowNote(6, 1440)).toBeNull()
  })

  test('the dock resizes between 320 and 900, and at a 900 px window it is capped at 420', async () => {
    const { clampDockWidth } = await load<{ clampDockWidth: (width: number, windowWidth: number) => number }>('src/components/Workbench/dockWidth')
    expect(clampDockWidth(200, 1440)).toBe(320)
    expect(clampDockWidth(600, 1440)).toBe(600)
    expect(clampDockWidth(1200, 1920)).toBe(900)
    expect(clampDockWidth(600, 900)).toBe(420)
    expect(clampDockWidth(300, 900)).toBe(320)
  })

  test('the layout copy reads in pt-BR', async () => {
    await changeLanguage('pt-BR')
    const { Toaster } = await import('../../../src/ui/Toast')
    render(<Toaster />)
    const { reportSplitTooSmall } = await import('../../../src/components/Grid/splitRefusal') as unknown as { reportSplitTooSmall: (size: { width: number; height: number }) => void }
    act(() => reportSplitTooSmall({ width: 180, height: 300 }))
    expect(await screen.findByText('Sem espaço para dividir: os painéis ficariam com 180 × 300 px, abaixo de 240 × 120.')).toBeInTheDocument()
    const { paneOverflowNote } = await load<{ paneOverflowNote: (panes: number, width: number) => string | null }>('src/components/Grid/paneOverflow')
    expect(paneOverflowNote(6, 900)).toBe('6 painéis não cabem nesta largura, então aparecem um por vez.')
  })
})
