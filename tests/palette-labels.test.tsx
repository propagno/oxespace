import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadSnapshot } from '../shared/types/thread'
import type { Workspace, WorkspacePane } from '../shared/types/workspace'
import '../src/commands/activity.commands'
import { buildCodeCommands } from '../src/commands/code.commands'
import { COMMAND_CATEGORIES, commandCategoryLabel } from '../src/commands/commandText'
import { goToPane, goToWorkspace } from '../src/commands/goTo'
import '../src/commands/settings.commands'
import { buildThreadCommands } from '../src/commands/thread.commands'
import { CommandMenu } from '../src/components/CommandMenu/CommandMenu'
import { buildAppMenus, type AppMenuNode } from '../src/components/Navigation/appMenus'
import '../src/components/OxePod/oxepod.commands'
import '../src/components/OxePost/oxepost.commands'
import '../src/components/OxeQuery/oxequery.commands'
import { changeLanguage } from '../src/i18n'
import { useCommandSource } from '../src/commands/useCommandSource'
import { useContributedCommands, type CommandPaletteAction, type ContributedCommand } from '../src/utils/commandRegistry'

/** Docs: docs/design/commands.md. Every action starts with one of these verbs, capitalized. */
const VERBS: Record<'en' | 'pt-BR', string[]> = {
  en: ['Open', 'Show', 'Toggle', 'Create', 'Add', 'Find', 'Run', 'Search', 'Import', 'Export', 'Manage', 'Browse', 'Check', 'Mark', 'Report', 'Start',
    'Switch', 'Resume', 'Rename', 'Undo', 'Clean', 'Balance', 'Use', 'Follow', 'Split', 'Maximize', 'Restart', 'Stop'],
  'pt-BR': ['Abrir', 'Mostrar', 'Alternar', 'Criar', 'Adicionar', 'Encontrar', 'Executar', 'Buscar', 'Importar', 'Exportar', 'Gerenciar', 'Explorar',
    'Procurar', 'Marcar', 'Relatar', 'Iniciar', 'Mudar', 'Retomar', 'Renomear', 'Desfazer', 'Limpar', 'Equilibrar', 'Usar', 'Seguir', 'Dividir',
    'Maximizar', 'Reiniciar', 'Parar', 'Ligar']
}
/** Commands whose action is not a verb, and why. Grows only in review. */
const NOT_A_VERB: Record<string, string> = { 'help.about': 'conventional "About <product>" item' }
/**
 * Words that really are the same in English and Portuguese. A label may read the same in both languages only when
 * every word of it is on this list. Grows only in review; never a pattern.
 */
const SAME_IN_BOTH = new Set([
  // Product names
  'OxeCode', 'OxeChat', 'OxeQuery', 'OxePod', 'OxePost', 'OXESpace',
  // Terms nobody translates
  'Terminal', 'Git', 'Docker', 'MCP', 'SQL'
])

const noop = (): void => undefined
const pane = (id: string, extra: Partial<WorkspacePane> = {}): WorkspacePane => ({ id, workspaceId: 'w1', type: 'terminal', rowIndex: 0, columnIndex: 0, shellProfileId: null,
  status: 'idle', agentProfileId: null, agentName: null, displayName: null, createdAt: null, rootPath: null, ...extra })
const TEMP_PATH = 'C:\\Users\\someone\\AppData\\Local\\Temp\\oxespace-e2e-a1b2c3\\demo-project'
const workspaces = [
  { id: 'w1', name: 'demo-project', rootPath: TEMP_PATH, panes: [pane('p1'), pane('p2'), pane('p3', { type: 'terminal', agentName: 'Claude', displayName: 'Reviewer' })] },
  { id: 'w2', name: '', rootPath: '/home/someone/src/api', panes: [] }
] as unknown as Workspace[]
const snapshot = { thread: { id: 't1' }, turns: [{ id: 'turn', status: 'done' }] } as unknown as ThreadSnapshot
const projects = [{ projectId: 'p1', displayName: 'repo', identityLabel: 'C:/repo', hidden: false, contexts: [] }, { projectId: 'p2', displayName: 'site', identityLabel: 'C:/site', hidden: false, contexts: [] }]

/** Every command the palette shows with a workspace, a running terminal, a conversation and projects open. */
function paletteCommands(): ContributedCommand[] {
  const code = buildCodeCommands({ applicationView: 'code', activeWorkspace: workspaces[0], activePane: workspaces[0].panes[0], hasTeamTarget: true, toolHandlers: {},
    openNewWorkspace: noop, splitActivePane: noop, toggleActivePaneMaximize: noop, toggleActivePaneVoice: noop, openDesignSystem: noop })
  const thread = buildThreadCommands({ snapshot, projects: projects as never, showThread: noop, newThread: noop, newThreadIn: noop, addProject: noop, openAccounts: noop })
  const { result, unmount } = renderHook(() => useContributedCommands())
  const registered = result.current.map(action => ({ id: action.id, label: action.title, action: action.action, category: action.category ?? '', keywords: action.keywords, shortcut: action.shortcut, run: action.run }))
  unmount()
  return [...registered, ...code, ...thread]
}
const goToLabels = (): string[] => [...workspaces.map(w => goToWorkspace(w).label), ...workspaces[0].panes.map(p => goToPane(p, workspaces[0].panes).label)]

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const words = (label: string): string[] => label.split(/[^\p{L}\p{N}]+/u).filter(Boolean)

afterEach(async () => { await act(async () => { await changeLanguage('en') }) })

describe('command palette labels', () => {
  for (const language of ['en', 'pt-BR'] as const) {
    it(`read "<Category>: <Action>" with a known category and a verb first (${language})`, async () => {
      await act(async () => { await changeLanguage(language) })
      const categories = COMMAND_CATEGORIES.map(commandCategoryLabel)
      const pattern = new RegExp(`^(${categories.map(escape).join('|')}): (\\S+)`)
      const commands = paletteCommands()
      expect(commands.length).toBeGreaterThanOrEqual(90)
      const wrong: string[] = []
      for (const command of commands) {
        const match = pattern.exec(command.label)
        if (!match) { wrong.push(`${command.id}: "${command.label}" has no known category`); continue }
        if (match[1] !== commandCategoryLabel(command.category)) wrong.push(`${command.id}: "${command.label}" is grouped under ${command.category}`)
        if (command.label !== `${match[1]}: ${command.action}`) wrong.push(`${command.id}: "${command.label}" is not its category and its action "${command.action}"`)
        if (!NOT_A_VERB[command.id] && !VERBS[language].includes(match[2])) wrong.push(`${command.id}: "${command.label}" does not start with a known verb`)
      }
      // "Go to" rows name a place: the category is the verb.
      for (const label of goToLabels()) if (!label.startsWith(`${commandCategoryLabel('Go to')}: `)) wrong.push(`"${label}" is not a Go to row`)
      expect(wrong).toEqual([])
    })
  }

  it('are translated in pt-BR: a label reads the same in English only when all its words are names', async () => {
    const english = new Map(paletteCommands().map(command => [command.id, command.label]))
    const englishGoTo = goToLabels()
    await act(async () => { await changeLanguage('pt-BR') })
    const portuguese = paletteCommands()
    expect(portuguese.length).toBe(english.size)
    const untranslated = portuguese.filter(command => command.label === english.get(command.id) && !words(command.label).every(word => SAME_IN_BOTH.has(word)))
    expect(untranslated.map(command => `${command.id}: ${command.label}`)).toEqual([])
    expect(goToLabels().filter((label, index) => label === englishGoTo[index])).toEqual([])
  })

  it('keep every command id and shortcut of the base branch', () => {
    const base = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/palette-commands.base.json'), 'utf8')) as Record<string, string | null>
    // The base list was taken with one project (p1) and no workspace; the same commands exist here.
    const now = Object.fromEntries(paletteCommands().filter(command => command.id !== 'thread.project.p2').map(command => [command.id, command.shortcut ?? null]))
    expect(now).toEqual(base)
  })

  it('name Go to rows by folder and project, with the full path only in the tooltip and the search', () => {
    const demo = goToWorkspace(workspaces[0])
    expect(demo).toEqual({ label: 'Go to: demo-project', name: 'demo-project', detail: '…/oxespace-e2e-a1b2c3/demo-project', path: TEMP_PATH })
    expect(goToWorkspace(workspaces[1])).toMatchObject({ label: 'Go to: api', detail: '…/src/api' })
    expect(workspaces[0].panes.map(p => goToPane(p, workspaces[0].panes).label)).toEqual(['Go to: Terminal 1', 'Go to: Terminal 2', 'Go to: Reviewer'])
  })
})

describe('application menus and the palette', () => {
  const flat = (nodes: AppMenuNode[]): AppMenuNode[] => nodes.flatMap(node => node.kind === 'submenu' ? [node, ...flat(node.children)] : [node])
  for (const language of ['en', 'pt-BR'] as const) {
    it(`say the same action for the same command, from one key (${language})`, async () => {
      await act(async () => { await changeLanguage(language) })
      const actions: CommandPaletteAction[] = paletteCommands().map(command => ({ id: command.id, title: command.label, action: command.action, category: command.category, run: command.run }))
      const byId = new Map(actions.map(action => [action.id, action]))
      const items = buildAppMenus({ actions, applicationView: 'code', setApplicationView: noop, openSettings: noop, addThreadProject: noop, openCommandMenu: noop })
        .flatMap(menu => flat(menu.items)).filter(node => node.kind === 'item' && byId.has(node.id)) as Array<Extract<AppMenuNode, { kind: 'item' }>>
      expect(items.length).toBeGreaterThan(30)
      for (const item of items) {
        const action = byId.get(item.id)!
        expect(item.label).toBe(action.action)
        expect(action.title.endsWith(`: ${item.label}`)).toBe(true)
      }
      const about = items.find(item => item.id === 'help.about')!
      expect(about.label).toBe(language === 'en' ? 'About OXESpace' : 'Sobre o OXESpace')
      expect(items.find(item => item.id === 'help.shortcuts')?.label).toBe(language === 'en' ? 'Show keyboard shortcuts' : 'Mostrar os atalhos de teclado')
      // The Thread File menu adds a project with the palette's words.
      const thread = buildAppMenus({ actions, applicationView: 'thread', setApplicationView: noop, openSettings: noop, addThreadProject: noop, openCommandMenu: noop })
      expect(flat(thread[0].items).find(node => node.id === 'add-project')).toMatchObject({ label: byId.get('thread.add-project')!.action })
    })
  }
})

class ResizeObserverStub { observe(): void { /* cmdk */ } unobserve(): void { /* cmdk */ } disconnect(): void { /* cmdk */ } }

describe('palette search', () => {
  function Palette(): React.ReactElement {
    useCommandSource('test-code', buildCodeCommands({ applicationView: 'code', activeWorkspace: workspaces[0], activePane: workspaces[0].panes[0], hasTeamTarget: true, toolHandlers: {},
      openNewWorkspace: noop, splitActivePane: noop, toggleActivePaneMaximize: noop, toggleActivePaneVoice: noop, openDesignSystem: noop }))
    const actions = useContributedCommands()
    return <CommandMenu open onOpenChange={noop} workspace={workspaces[0]} actions={actions} workspaces={workspaces} onSelectWorkspace={noop} onSelectPane={noop} />
  }
  const setup = (): void => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    Element.prototype.scrollIntoView = vi.fn()
    window.oxe = { ...window.oxe, search: { listFiles: vi.fn().mockResolvedValue({ files: [] }), run: vi.fn().mockResolvedValue({ files: [], totalMatches: 0 }) }, semantic: { query: vi.fn().mockResolvedValue([]) } } as never
  }
  /** The first command row for a query, as the palette ranks it. */
  async function firstCommand(query: string): Promise<string> {
    fireEvent.change(screen.getByRole('combobox'), { target: { value: query } })
    return await waitFor(() => {
      const option = [...document.querySelectorAll('[cmdk-item][data-value^="cmd-"]')][0]
      if (!option) throw new Error(`nothing for ${query}`)
      return option.querySelector('[class*="label"]')!.textContent!
    })
  }

  it('finds a command by its old name, in English and in Portuguese', async () => {
    setup()
    render(<Palette />)
    expect(await firstCommand('Keyboard shortcuts')).toBe('Help: Show keyboard shortcuts')
    expect(await firstCommand('Restart terminal')).toBe('Terminal: Restart')
    expect(await firstCommand('Semantic index log')).toBe('Agents: Show semantic index log')
    expect(await firstCommand('Workspace settings')).toBe('Workspace: Open workspace settings')
    expect(await firstCommand('Settings: Keyboard')).toBe('Settings: Open keyboard settings')
    await act(async () => { await changeLanguage('pt-BR') })
    expect(await firstCommand('Reiniciar o terminal')).toBe('Terminal: Reiniciar')
    expect(await firstCommand('Atalhos de teclado')).toBe('Ajuda: Mostrar os atalhos de teclado')
    // English words keep working in Portuguese.
    expect(await firstCommand('Restart terminal')).toBe('Terminal: Reiniciar')
  })

  it('lists workspaces and panes under one Go to group, short, with the full path searchable and in the tooltip', async () => {
    setup()
    render(<Palette />)
    const group = await waitFor(() => [...document.querySelectorAll('[cmdk-group]')].find(node => node.querySelector('[cmdk-group-heading]')?.textContent === 'Go to') as HTMLElement)
    expect(within(group).getByText('Go to: demo-project')).toBeInTheDocument()
    expect(within(group).getByText('Go to: Terminal 2')).toBeInTheDocument()
    expect(group.textContent).not.toContain(TEMP_PATH)
    expect(group.querySelector('[data-value="ws-w1"]')?.getAttribute('title')).toBe(TEMP_PATH)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'oxespace-e2e-a1b2c3' } })
    await waitFor(() => expect(document.querySelector('[data-value="ws-w1"]')).not.toBeNull())
  })
})
