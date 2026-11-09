// Frozen acceptance test for the 1.5.0 F2 gap G3 (OXE program, phase F2, task FE-G3). Written by the planner; the executor
// must not edit it. Spec: .claude/roadmap-1.4/team/plans/f2-removals-FRONTEND.json and f2-gaps-FRONTEND.json (FE-G3).
// What a person sees, not source paths: every label and detail of the command palette (the code and thread command
// builders plus everything registered at boot), the application menus built from those commands, and the workspace tool
// catalog, read in English and in Portuguese, names none of the features 1.5.0 removed.
import { cleanup, renderHook } from '@testing-library/react'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

/** The removed features as a person would read them, per language. Skills stay (a read-only list and /), so only the
 *  manager's own words are here. */
const REMOVED: Record<'en' | 'pt-BR', RegExp[]> = {
  en: [/\bOxePost\b/i, /\bOxePod\b/i, /\bRTK\b/, /\bLinear\b/i, /\bProject team\b/i, /\bTeams?\b/, /\bAutomations?\b/i, /\bAI Memory\b/i,
    /\bProject memory\b/i, /\bSemantic\b/i, /\bsearch by meaning\b/i, /\bvector index\b/i, /\bCodeGraph\b/i, /\bSkills manager\b/i, /\bskill prompts\b/i,
    /\bWork runs?\b/i, /\bDocumentation tools\b/i],
  'pt-BR': [/\bOxePost\b/i, /\bOxePod\b/i, /\bRTK\b/, /\bLinear\b/i, /\bEquipe do projeto\b/i, /\bEquipes?\b/, /\bAutomaç(ão|ões)\b/i,
    /\bMemória (de IA|do projeto)\b/i, /\bsemântic[oa]\b/i, /\bbusca por significado\b/i, /índice vetorial/i, /\bCodeGraph\b/i,
    /\bgerenciador de skills\b/i, /\bprompts de skill\b/i, /\bexecuç(ão|ões) de trabalho\b/i, /\bferramentas de documentação\b/i]
}

type Visible = { where: string; text: string }
type Command = { id: string; label: string; detail?: string; category: string }
type MenuNode = { kind: string; id: string; label?: string; children?: MenuNode[] }

async function visibleText(): Promise<Visible[]> {
  const noop = vi.fn()
  const { buildCodeCommands } = await import('../../../src/commands/code.commands')
  const { buildThreadCommands } = await import('../../../src/commands/thread.commands')
  await import('../../../src/commands/settings.commands')
  await import('../../../src/commands/activity.commands')
  const { useContributedCommands } = await import('../../../src/utils/commandRegistry')
  const { buildAppMenus } = await import('../../../src/components/Navigation/appMenus')
  const { TOOL_CATALOG } = await import('../../../src/components/Workspace/toolCatalog')
  const workspace = { id: 'ws-1', name: 'repo', rootPath: '/repo', panes: [] }
  const code = buildCodeCommands({
    applicationView: 'code', activeWorkspace: workspace, activePane: null, toolHandlers: {}, openNewWorkspace: noop,
    splitActivePane: noop, toggleActivePaneMaximize: noop, openDesignSystem: noop
  } as never) as unknown as Command[]
  const thread = buildThreadCommands({ snapshot: null, projects: [], showThread: noop, newThread: noop, newThreadIn: noop, addProject: noop, openAccounts: noop } as never) as unknown as Command[]
  const { result, unmount } = renderHook(() => useContributedCommands())
  const registered = result.current as unknown as Array<{ id: string; title: string; subtitle?: string; category?: string }>
  unmount()
  const actions = [...code, ...thread].map(command => ({ id: command.id, title: command.label, action: command.label, category: command.category, run: noop }))
  const menus = buildAppMenus({ actions: [...actions, ...registered.map(action => ({ ...action, run: noop }))], applicationView: 'code', setApplicationView: noop, openSettings: noop, addThreadProject: noop, openCommandMenu: noop, version: '1.5.0' } as never) as unknown as Array<{ label: string; items: MenuNode[] }>
  const flat = (nodes: MenuNode[]): MenuNode[] => nodes.flatMap(node => [node, ...flat(node.children ?? [])])
  return [
    ...[...code, ...thread].flatMap(command => [{ where: `command ${command.id}`, text: command.label }, { where: `command ${command.id} detail`, text: command.detail ?? '' }]),
    ...registered.flatMap(action => [{ where: `palette ${action.id}`, text: action.title }, { where: `palette ${action.id} detail`, text: action.subtitle ?? '' }]),
    ...menus.flatMap(menu => [{ where: `menu ${menu.label}`, text: menu.label }, ...flat(menu.items).map(node => ({ where: `menu item ${node.id}`, text: node.label ?? '' }))]),
    ...TOOL_CATALOG.flatMap(tool => [{ where: `tool ${tool.id}`, text: tool.label }, { where: `tool ${tool.id} detail`, text: tool.detail }])
  ].filter(item => item.text)
}

const offenders = (items: Visible[], terms: RegExp[]): string[] => items.flatMap(item => terms.filter(term => term.test(item.text)).map(term => `${item.where}: "${item.text}" ~ ${term.source}`))

afterAll(async () => { cleanup(); await changeLanguage('en') })

describe('G3 · nothing a person sees names a removed feature', () => {
  test('the command palette, the application menus and the tool catalog name no removed feature, in English', async () => {
    await changeLanguage('en')
    const items = await visibleText()
    expect(items.length).toBeGreaterThan(40)
    expect(offenders(items, REMOVED.en)).toEqual([])
  })

  test('the command palette, the application menus and the tool catalog name no removed feature, in Portuguese', async () => {
    await changeLanguage('pt-BR')
    const items = await visibleText()
    expect(items.length).toBeGreaterThan(40)
    expect(offenders(items, REMOVED['pt-BR'])).toEqual([])
  })
})
