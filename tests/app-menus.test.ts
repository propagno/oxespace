import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { buildAppMenus, MENU_ACTION_IDS, MENU_ACTION_PREFIXES, type AppMenuNode } from '../src/components/Navigation/appMenus'
import { TOOL_CATALOG } from '../src/components/Workspace/toolCatalog'

/** The command modules (src/commands/*.commands.ts) the palette and menus run. */
function commandSources(): string {
  const dir = join(process.cwd(), 'src/commands')
  return readdirSync(dir).filter(name => name.endsWith('.commands.ts')).map(name => readFileSync(join(dir, name), 'utf8')).join('\n')
}

/** The palette actions the command modules declare: literal ids, one per tool, and the families built from a template. */
function declaredActionIds(): Set<string> {
  const source = commandSources()
  const literal = [...source.matchAll(/\bid: '([a-z0-9.-]+)'/g)].map(match => match[1])
  // Settings pages are built from a list: `settings.<page>`.
  const pages = [...source.matchAll(/\{ page: '([a-z]+)'/g)].map(match => `settings.${match[1]}`)
  return new Set([...literal, ...pages, ...TOOL_CATALOG.map(tool => `tool-${tool.id}`)])
}

const flat = (nodes: AppMenuNode[]): AppMenuNode[] => nodes.flatMap(node => node.kind === 'submenu' ? [node, ...flat(node.children)] : [node])

describe('application menus', () => {
  it('point only to palette actions that exist, so no item disappears silently', () => {
    const ids = declaredActionIds()
    expect(MENU_ACTION_IDS.filter(id => !ids.has(id))).toEqual([])
    const source = commandSources()
    for (const prefix of MENU_ACTION_PREFIXES) expect(source).toContain(`id: \`${prefix}`)
  })

  it('show every listed action and the appearance choices without a workspace', () => {
    const run = vi.fn()
    const actions = [...MENU_ACTION_IDS.map(id => ({ id, title: id, category: 'Test', run })),
      ...['system', 'light', 'dark'].map(mode => ({ id: `appearance-${mode}`, title: `Appearance: ${mode}`, category: 'Appearance', run }))]
    const menus = buildAppMenus({ actions, applicationView: 'code', setApplicationView: vi.fn(), openSettings: vi.fn(), addThreadProject: vi.fn(), openCommandMenu: vi.fn(), version: '1.4.0' })
    const shown = new Set(menus.flatMap(menu => flat(menu.items)).map(node => node.id))
    expect(MENU_ACTION_IDS.filter(id => !shown.has(id))).toEqual([])
    const appearance = menus.flatMap(menu => flat(menu.items)).find(node => node.id === 'appearance')
    expect(appearance).toMatchObject({ kind: 'submenu', label: 'Appearance' })
    expect(appearance && 'disabled' in appearance ? appearance.disabled : undefined).toBeFalsy()
  })

  it('File > Exit closes the window only after the question about work in progress allows it (FUNC-3)', async () => {
    const menus = buildAppMenus({ actions: [], applicationView: 'code', setApplicationView: vi.fn(), openSettings: vi.fn(), addThreadProject: vi.fn(), openCommandMenu: vi.fn(), version: '1.5.0' })
    const exit = menus.flatMap(menu => flat(menu.items)).find(node => node.id === 'quit')
    if (!exit || exit.kind !== 'item') throw new Error('File > Exit is missing')
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined)
    const before = (window as unknown as { oxe?: Record<string, unknown> }).oxe
    try {
      // Nothing running: it closes.
      Object.assign(window, { oxe: { ...before, thread: { list: vi.fn(async () => []) } } })
      exit.onSelect()
      await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1))
      // A turn in progress: the question comes first, and nothing closes while it is open.
      Object.assign(window, { oxe: { ...before, thread: { list: vi.fn(async () => [{ id: 't1', title: 'Fix the Pix webhook', status: 'running' }]) } } })
      exit.onSelect()
      await vi.waitFor(() => expect(document.querySelector('[data-testid="unsaved-work-dialog"]')).not.toBeNull(), { timeout: 20_000 })
      expect(close).toHaveBeenCalledTimes(1)
      const cancel = [...document.querySelectorAll('button')].find(button => button.textContent === 'Cancel')
      cancel!.click()
      await vi.waitFor(() => expect(document.querySelector('[data-testid="unsaved-work-dialog"]')).toBeNull())
      expect(close).toHaveBeenCalledTimes(1)
    } finally {
      close.mockRestore()
      Object.assign(window, { oxe: before })
    }
  }, 30_000)
})
