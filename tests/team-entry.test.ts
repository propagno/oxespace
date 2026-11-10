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
  openNewWorkspace: vi.fn(), splitActivePane: vi.fn(), toggleActivePaneMaximize: vi.fn(), openDesignSystem: vi.fn(), ...over
})
const teamCommand = (over: Partial<CodeCommandContext> = {}) => buildCodeCommands(context(over)).find(command => command.id === 'tool-team')!
/** The palette action a contributed command becomes (commandRegistry). */
const asAction = (command: ContributedCommand): CommandPaletteAction => ({ id: command.id, title: command.label, action: command.action, subtitle: command.detail, disabled: command.disabled, shortcut: command.shortcut, run: command.run })
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

  it('is "Agents: Open the project team…" in the palette (F17) with its shortcut, and found by English or Portuguese words', async () => {
    const command = teamCommand({ hasTeamTarget: true })
    expect(command).toMatchObject({ label: 'Agents: Open the project team…', detail: 'Project roles and agent inboxes', shortcut: 'team.open', disabled: false })
    expect(command.keywords).toEqual(expect.arrayContaining(['team', 'equipe', 'time', 'papéis', 'membros']))
    await changeLanguage('pt-BR')
    expect(teamCommand({ hasTeamTarget: true }).label).toBe('Agentes: Abrir a equipe do projeto…')
  })

  it('says why it cannot open: the palette description and the second line of the Tools menu item', () => {
    const reason = 'Open a workspace to open its team'
    expect(teamCommand({ teamUnavailable: reason })).toMatchObject({ disabled: true, detail: reason })
    const item = toolsMenu({ teamUnavailable: reason }).find(node => node.id === 'tool-team')
    // Not `disabled`: a disabled menu item is skipped by the keyboard and screen readers, and its reason with it.
    expect(item).toMatchObject({ kind: 'item', label: 'Open the project team…', shortcut: shortcutLabel('team.open'), unavailable: reason })
    expect(item && 'disabled' in item ? item.disabled : undefined).toBeFalsy()
    const openable = toolsMenu({ hasTeamTarget: true }).find(node => node.id === 'tool-team')
    expect(openable).toMatchObject({ disabled: false })
    expect(openable).not.toHaveProperty('unavailable')
  })

  it('reads "Abrir a equipe do projeto…" in the Portuguese Tools menu, next to MCP servers', async () => {
    await changeLanguage('pt-BR')
    const ids = toolsMenu({ hasTeamTarget: true }).map(node => node.id)
    expect(ids.slice(0, 2)).toEqual(['tool-mcp', 'tool-team'])
    // R12 took the skills manager out; skills live in Settings › MCP servers and skills.
    expect(ids).not.toContain('tool-skills')
    expect(toolsMenu({ hasTeamTarget: true }).find(node => node.id === 'tool-team')).toMatchObject({ label: 'Abrir a equipe do projeto…' })
  })

  it('leaves the title bar: its trailing group is the activity bell and the update chips', () => {
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8')
    const trailing = app.match(/<div className=\{titleBar\.trailing\}>(.*?)<\/div>/s)?.[1] ?? ''
    expect(trailing).toContain('<ActivityCenter')
    expect(trailing).not.toMatch(/Team/)
  })
})
