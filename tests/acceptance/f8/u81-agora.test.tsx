// Frozen acceptance test for 1.5.0 A29 under CR-F8-Triad (10/11/2026 handoff, OXE program, phase F8, task FE-A29).
// Spec: .claude/roadmap-1.4/team/plans/1.5.0-triad-consolidation-handoff.md (D1 & §3 F8).
// Standalone T82 Agora view, .agora-b button, and Mod+Shift+G are cancelled; OxeChat ('thread') is the cold-start
// home screen and fallback for removed views ('post', 'pods'), while supervision lives unified in #queue (CR-F7-Triad).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, test } from 'vitest'

async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}

describe('U8.1 · CR-F8-Triad start screen & triad consolidation', () => {
  test("OxeSpace cold-starts on OxeChat ('thread'), and a remembered removed view ('post' or 'pods') lands on OxeChat too while valid triad views ('code', 'thread', 'data') are respected", async () => {
    const { initialAppView } = await load<{ initialAppView: (remembered: string | null) => string }>('src/app/startView')
    expect(initialAppView(null)).toBe('thread')
    expect(initialAppView('')).toBe('thread')
    expect(initialAppView('post')).toBe('thread')
    expect(initialAppView('pods')).toBe('thread')
    expect(initialAppView('agora')).toBe('thread')
    expect(initialAppView('code')).toBe('code')
    expect(initialAppView('thread')).toBe('thread')
    expect(initialAppView('data')).toBe('data')
  })

  test("AppView stays strictly the triad ('code' | 'thread' | 'data'), with no standalone Agora view, no .agora-b title-bar button, and Mod+Shift+G unbound", async () => {
    const { APP_VIEWS, KEYBINDINGS } = await import('../../../src/keyboard/keybindings')
    expect([...APP_VIEWS]).toEqual(['code', 'thread', 'data'])
    expect(existsSync(join(process.cwd(), 'src/components/Agora/Agora.tsx'))).toBe(false)
    expect(Object.keys(KEYBINDINGS).some(id => /agora/i.test(id))).toBe(false)
    expect(Object.values(KEYBINDINGS).some(entry => /Mod\+Shift\+G/i.test((entry as { default?: string }).default ?? ''))).toBe(false)
  })
})
