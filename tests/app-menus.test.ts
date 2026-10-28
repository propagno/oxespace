import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { buildAppMenus, MENU_ACTION_IDS, MENU_ACTION_PREFIXES, type AppMenuNode } from '../src/components/Navigation/appMenus'
import { TOOL_CATALOG } from '../src/components/Workspace/toolCatalog'

/** The palette actions App.tsx declares: literal ids, one per tool, and the families built from a template. */
function declaredActionIds(): Set<string> {
  const source = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8')
  const literal = [...source.matchAll(/\bid: '([a-z0-9-]+)'/g)].map(match => match[1])
  return new Set([...literal, ...TOOL_CATALOG.map(tool => `tool-${tool.id}`)])
}

const flat = (nodes: AppMenuNode[]): AppMenuNode[] => nodes.flatMap(node => node.kind === 'submenu' ? [node, ...flat(node.children)] : [node])

describe('application menus', () => {
  it('point only to palette actions that exist, so no item disappears silently', () => {
    const ids = declaredActionIds()
    expect(MENU_ACTION_IDS.filter(id => !ids.has(id))).toEqual([])
    const source = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8')
    for (const prefix of MENU_ACTION_PREFIXES) expect(source).toContain(`id: \`${prefix}`)
  })

  it('show every listed action and the appearance choices without a workspace', () => {
    const run = vi.fn()
    const actions = [...MENU_ACTION_IDS.map(id => ({ id, title: id, category: 'Test', run })),
      ...['system', 'light', 'dark'].map(mode => ({ id: `appearance-${mode}`, title: `Appearance: ${mode}`, category: 'Appearance', run }))]
    const menus = buildAppMenus({ actions, applicationView: 'code', setApplicationView: vi.fn(), openSettings: vi.fn(), addThreadProject: vi.fn(), version: '1.4.0' })
    const shown = new Set(menus.flatMap(menu => flat(menu.items)).map(node => node.id))
    expect(MENU_ACTION_IDS.filter(id => !shown.has(id))).toEqual([])
    const appearance = menus.flatMap(menu => flat(menu.items)).find(node => node.id === 'appearance')
    expect(appearance).toMatchObject({ kind: 'submenu', label: 'Appearance' })
    expect(appearance && 'disabled' in appearance ? appearance.disabled : undefined).toBeFalsy()
  })
})
