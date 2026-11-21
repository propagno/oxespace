// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-246, PM-02·8, CA-1 to CA-3; brand-approved POLISH-02 #8,
// adjusted by the brand: (a) and (b) as written, (c) only --surface-overlay and the heights).
// Written by the planner; the executor must not edit it.
// Today (main 4b7015c89) View › Density is disabled with no workspace open (appMenus.ts noWorkspace; the density commands
// of src/commands/code.commands.ts are disabled without an active workspace and write the workspace's uiDensity), Edit
// writes "Ctrl+Z" … "Ctrl+A" on macOS too, and AppMenuBar.css paints the menu --surface-raised with a 26×26 trigger.
// Contract:
// - (a) With no workspace, the View menu's Density submenu and its items are enabled (no disabled, no "needs a workspace"
//   reason), and choosing Comfortable sets the app's density (useSettingsStore density 'comfortable'), the global
//   setting RN-1 says needs no workspace.
// - (b) Edit's shortcuts are formatChord('Mod+Z'), formatChord('Mod+Shift+Z'), formatChord('Mod+X'), formatChord('Mod+C'),
//   formatChord('Mod+V') and formatChord('Mod+A'): "Cmd+…" on macOS, "Ctrl+…" on Windows and Linux.
// - (c) SOURCE-TEXT check (marked): AppMenuBar.css gives .app-menu-content background var(--surface-overlay), .app-menu-item
//   height var(--row-1) and the .app-menu-button trigger height var(--control-sm).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

type Node = { kind: string; id: string; label?: string; shortcut?: string; disabled?: boolean; unavailable?: string; children?: Node[]; onSelect?: () => void }
const ORIGINAL_PLATFORM = Object.getOwnPropertyDescriptor(window.navigator, 'platform')

async function menusOn(platform: string): Promise<Array<{ id: string; items: Node[] }>> {
  vi.resetModules()
  Object.defineProperty(window.navigator, 'platform', { configurable: true, get: () => platform })
  const { buildAppMenus } = await import('../../../src/components/Navigation/appMenus')
  const { buildCodeCommands } = await import('../../../src/commands/code.commands')
  const actions = buildCodeCommands({ applicationView: 'thread', activeWorkspace: null, activePane: null, toolHandlers: {}, openNewWorkspace: vi.fn(), splitActivePane: vi.fn(),
    toggleActivePaneMaximize: vi.fn(), openDesignSystem: vi.fn() })
  return buildAppMenus({ actions: actions as never, applicationView: 'thread', setApplicationView: vi.fn(), openSettings: vi.fn(), addThreadProject: vi.fn(), openCommandMenu: vi.fn() }) as never
}
const css = readFileSync(join(process.cwd(), 'src/components/Navigation/AppMenuBar.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rule = (selector: string): string => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(match => match[1].split(',').map(part => part.trim()).includes(selector)).map(match => match[2]).join(';')

afterEach(() => {
  if (ORIGINAL_PLATFORM) Object.defineProperty(window.navigator, 'platform', ORIGINAL_PLATFORM)
  else delete (window.navigator as { platform?: string }).platform
  vi.resetModules()
})

describe('OXE-246 PM-02·8 the app menus', () => {
  it('(a) with no workspace, View › Density is enabled and Comfortable sets the app density', async () => {
    const menus = await menusOn('Win32')
    const view = menus.find(menu => menu.id === 'view')
    const density = view?.items.find(node => node.id === 'densities')
    expect(density, 'the Density submenu').toBeDefined()
    expect(density?.disabled ?? false).toBe(false)
    const children = density?.children ?? []
    expect(children.length).toBeGreaterThanOrEqual(2)
    for (const child of children) {
      expect(child.disabled ?? false, `${child.id} is enabled`).toBe(false)
      expect(child.unavailable, `${child.id} gives no reason`).toBeUndefined()
    }
    const { useSettingsStore } = await import('../../../src/store/settings.store')
    useSettingsStore.setState({ density: 'compact' } as never)
    children.find(child => /comfortable/.test(child.id))?.onSelect?.()
    expect(useSettingsStore.getState().density).toBe('comfortable')
  })

  it.each([['MacIntel', 'Cmd'], ['Win32', 'Ctrl'], ['Linux x86_64', 'Ctrl']])('(b) on %s Edit shows formatChord shortcuts (%s)', async (platform, mod) => {
    const menus = await menusOn(platform)
    const { formatChord } = await import('../../../src/keyboard/chords')
    const edit = menus.find(menu => menu.id === 'edit')
    const shortcut = (id: string): string | undefined => edit?.items.find(node => node.id === id)?.shortcut
    const expected: Record<string, string> = { undo: 'Mod+Z', redo: 'Mod+Shift+Z', cut: 'Mod+X', copy: 'Mod+C', paste: 'Mod+V', 'select-all': 'Mod+A' }
    for (const [id, chord] of Object.entries(expected)) expect(shortcut(id), id).toBe(formatChord(chord))
    expect(shortcut('undo')?.startsWith(mod)).toBe(true)
  })

  it('(c) the menu is --surface-overlay, its items --row-1 tall, the trigger --control-sm (source text, marked)', () => {
    expect(rule('.app-menu-content')).toMatch(/background(-color)?\s*:\s*var\(--surface-overlay\)/)
    expect(rule('.app-menu-item')).toMatch(/(^|[;\s])height\s*:\s*var\(--row-1\)/)
    expect(rule('.app-menu-button')).toMatch(/(^|[;\s])height\s*:\s*var\(--control-sm\)/)
  })
})
