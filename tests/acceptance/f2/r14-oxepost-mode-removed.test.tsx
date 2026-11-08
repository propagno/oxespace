// Frozen acceptance test for the 1.5.0 cockpit removal R14, renderer side (OXE program, phase F2, task FE-R14). Written by
// the planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/f2-removals-FRONTEND.json (FE-R14).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
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

describe('R14 · the OxePost mode leaves', () => {
  test('the app has no post view and the mode switch has no OxePost entry', async () => {
    const { APP_VIEWS } = await import('../../../src/keyboard/keybindings')
    expect(APP_VIEWS as readonly string[]).not.toContain('post')
    const { ModeSwitch } = await import('../../../src/components/Navigation/ModeSwitch')
    render(<ModeSwitch mode="code" onSelect={() => undefined} />)
    expect(await screen.findByRole('button', { name: 'OxeCode' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'OxePost' })).toBeNull()
  })

  test('the OxePost renderer and its keybinding scope are gone', async () => {
    expect(existsSync(join(ROOT, 'src/components/OxePost'))).toBe(false)
    expect(sources('src').filter(file => /OxePost\/|oxepost\.store|OxePostView|OxePostSidebar/.test(read(file)))).toEqual([])
    const { KEYBINDINGS, SCOPE_LABELS } = await import('../../../src/keyboard/keybindings')
    expect(KEYBINDINGS.map(binding => binding.id as string).filter(id => id.startsWith('oxepost.') || id === 'view.post')).toEqual([])
    expect(Object.keys(SCOPE_LABELS)).not.toContain('oxepost')
  })

  test('the post catalog namespace is gone', async () => {
    const { NAMESPACES } = await import('../../../shared/i18n')
    expect(NAMESPACES as readonly string[]).not.toContain('post')
    expect(['en', 'pt-BR'].filter(locale => existsSync(join(ROOT, `shared/locales/${locale}/post.json`)))).toEqual([])
    expect(read('src/i18n/index.ts')).not.toMatch(/'post'/)
  })

  test('a remembered post view preloads nothing', async () => {
    const { lazyView } = await import('../../../src/lib/idlePreload')
    expect(lazyView('post')).toBeNull()
  })
})
