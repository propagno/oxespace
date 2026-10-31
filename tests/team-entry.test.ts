import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCodeCommands, type CodeCommandContext } from '../src/commands/code.commands'
import type { ContributedCommand, CommandPaletteAction } from '../src/utils/commandRegistry'
import { buildAppMenus, type AppMenuNode } from '../src/components/Navigation/appMenus'
import { changeLanguage, i18n } from '../src/i18n'
import { getKeybinding, isTerminalReservedChord, KEYBINDINGS, bindingsCollide, shortcutLabel, type Keybinding } from '../src/keyboard/keybindings'

afterEach(async () => { await changeLanguage('en') })

const context = (over: Partial<CodeCommandContext> = {}): CodeCommandContext => ({
  applicationView: 'code', activeWorkspace: null, activePane: null, hasTeamTarget: false, toolHandlers: {},
  openNewWorkspace: vi.fn(), splitActivePane: vi.fn(), toggleActivePaneMaximize: vi.fn(), toggleActivePaneVoice: vi.fn(), openDesignSystem: vi.fn(), ...over
})
const teamCommand = (over: Partial<CodeCommandContext> = {}) => buildCodeCommands(context(over)).find(command => command.id === 'tool-team')!
/** The palette action a contributed command becomes (commandRegistry). */
const asAction = (command: ContributedCommand): CommandPaletteAction => ({ id: command.id, title: command.label, subtitle: command.detail, disabled: command.disabled, shortcut: command.shortcut, run: command.run })
const toolsMenu = (over: Partial<CodeCommandContext> = {}): AppMenuNode[] => buildAppMenus({
  actions: buildCodeCommands(context(over)).map(asAction), applicationView: 'code', setApplicationView: vi.fn(), openSettings: vi.fn(),
  addThreadProject: vi.fn(), openCommandMenu: vi.fn(), version: '1.4.0'
}).find(menu => menu.id === 'tools')!.items

describe('the project Team, off the title bar (F35)', () => {
  it('has its own shortcut, Mod+Shift+T, that a focused terminal hands to the app and nothing else uses', () => {
    const binding = getKeybinding('team.open')
    expect(binding).toMatchObject({ chords: ['Mod+Shift+T'], scope: 'global', reservedInTerminal: true })
    expect(isTerminalReservedChord(new KeyboardEvent('keydown', { key: 'T', ctrlKey: true, shiftKey: true }))).toBe(true)
    const others = (KEYBINDINGS as readonly Keybinding[]).filter(other => other.id !== 'team.open' && bindingsCollide(binding, other, binding.chords, other.chords))
    expect(others.map(other => other.id)).toEqual([])
    expect(i18n.t('keys.bindings.team.open')).toBe('Open project team')
  })

  it('is "Project team" in the palette with its shortcut, and found by English or Portuguese words', async () => {
    const command = teamCommand({ hasTeamTarget: true })
    expect(command).toMatchObject({ label: 'Project team', detail: 'Project roles and agent inboxes', shortcut: 'team.open', disabled: false })
    expect(command.keywords).toEqual(expect.arrayContaining(['team', 'equipe', 'time', 'papéis', 'membros']))
    await changeLanguage('pt-BR')
    expect(teamCommand({ hasTeamTarget: true }).label).toBe('Equipe do projeto')
  })

  it('says why it cannot open: the palette description and the Tools menu tooltip', () => {
    const reason = 'Open a workspace to open its team'
    expect(teamCommand({ teamUnavailable: reason })).toMatchObject({ disabled: true, detail: reason })
    const item = toolsMenu({ teamUnavailable: reason }).find(node => node.id === 'tool-team')
    expect(item).toMatchObject({ kind: 'item', label: 'Project team…', shortcut: shortcutLabel('team.open'), disabled: true, title: reason })
    // Openable, the item has no tooltip of its own.
    expect(toolsMenu({ hasTeamTarget: true }).find(node => node.id === 'tool-team')).toMatchObject({ disabled: false, title: undefined })
  })

  it('reads "Equipe do projeto…" in the Portuguese Tools menu, next to MCP servers and Skills', async () => {
    await changeLanguage('pt-BR')
    const ids = toolsMenu({ hasTeamTarget: true }).map(node => node.id)
    expect(ids.slice(0, 3)).toEqual(['tool-mcp', 'tool-skills', 'tool-team'])
    expect(toolsMenu({ hasTeamTarget: true }).find(node => node.id === 'tool-team')).toMatchObject({ label: 'Equipe do projeto…' })
  })

  it('leaves the title bar: its trailing group is the activity bell and the update chips', () => {
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8')
    const trailing = app.match(/<div className=\{titleBar\.trailing\}>(.*?)<\/div>/s)?.[1] ?? ''
    expect(trailing).toContain('<ActivityCenter')
    expect(trailing).not.toMatch(/Team/)
  })
})
