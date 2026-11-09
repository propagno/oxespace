// Frozen acceptance test for the 1.5.0 cockpit removal R15, renderer side (OXE program, phase F2, task FE-R15). Written by
// the planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/f2-removals-FRONTEND.json (FE-R15).
// Only the mode leaves: src/components/OxePod stays in the tree, mounted nowhere, for F9's Containers panel (P1).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'

const ROOT = process.cwd()
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')
function sources(dir: string): string[] {
  const out: string[] = []
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(ROOT, rel))) {
      const path = `${rel}/${name}`
      if (statSync(join(ROOT, path)).isDirectory()) walk(path)
      else if (/\.(ts|tsx)$/.test(name)) out.push(path)
    }
  }
  walk(dir)
  return out
}

afterEach(() => { cleanup() })

describe('R15 · the OxePod mode leaves the mode switch', () => {
  test('the app has no pods view and the mode switch lists OxeCode, OxeChat and OxeQuery', async () => {
    const { APP_VIEWS } = await import('../../../src/keyboard/keybindings')
    expect([...APP_VIEWS]).toEqual(['code', 'thread', 'data'])
    const { ModeSwitch } = await import('../../../src/components/Navigation/ModeSwitch')
    render(<ModeSwitch mode="code" onSelect={() => undefined} />)
    await screen.findByRole('button', { name: 'OxeCode' })
    const modes = [...document.querySelectorAll('[data-app-mode]')].map(button => button.getAttribute('aria-label'))
    expect(modes).toEqual(['OxeCode', 'OxeChat', 'OxeQuery'])
  })

  test('the oxepod keybinding scope is gone', async () => {
    const { KEYBINDINGS, SCOPE_LABELS } = await import('../../../src/keyboard/keybindings')
    expect(KEYBINDINGS.map(binding => binding.id as string).filter(id => id.startsWith('oxepod.') || id === 'view.pods')).toEqual([])
    expect(Object.keys(SCOPE_LABELS)).not.toContain('oxepod')
  })

  test('nothing outside src/components/OxePod imports it', () => {
    const outside = sources('src').filter(file => !file.startsWith('src/components/OxePod/'))
    expect(outside.filter(file => /OxePod\/|oxepod\.store|oxepod-bridge/.test(read(file)))).toEqual([])
  })

  test('a remembered pods view preloads nothing', async () => {
    const { lazyView } = await import('../../../src/lib/idlePreload')
    expect(lazyView('pods')).toBeNull()
  })
})
