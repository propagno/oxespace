import { act, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mainMessage } from '../shared/messages'
import type { McpServer } from '../shared/types/mcp'
import '../src/commands/settings.commands'
import { McpServerSafety, quarantineReasons } from '../src/components/MCP/McpServerSafety'
import { useOxePostStore } from '../src/components/OxePost/oxepost.store'
import { SlashOverlay } from '../src/components/SlashOverlay/SlashOverlay'
import { commandCategoryLabel } from '../src/commands/commandText'
import { changeLanguage } from '../src/i18n'
import { formatMainMessage } from '../src/i18n/mainMessage'
import { getKeybinding } from '../src/keyboard/keybindings'
import { bindingLabel } from '../src/keyboard/labels'
import { useContributedCommands } from '../src/utils/commandRegistry'

/**
 * F6: the whole interface follows the language, including text built outside components (palette commands, shortcut
 * names, slash commands, store defaults) and the messages the main process sends as codes (C3).
 */
afterEach(async () => { await act(async () => { await changeLanguage('en') }) })

const quarantine = {
  at: 1, reasons: ['The description or inputs of "read" changed after you trusted it.', 'It added "write".'], added: ['write'], removed: [], changed: ['read'],
  codes: [mainMessage('mcp.quarantine.changed', { tools: ['"read"'] }), mainMessage('mcp.quarantine.added', { tools: ['"write"'] })]
}

describe('messages from the main process (C3)', () => {
  it('are worded from their code, in the language on screen', async () => {
    const message = mainMessage('mcp.quarantine.changed', { tools: ['search', 'fetch'] })
    expect(formatMainMessage(message)).toBe('The description or inputs of search and fetch changed after you trusted it.')
    expect(formatMainMessage(mainMessage('thread.request.notPending', {}))).toBe('This request was already answered, cancelled or expired.')
    await act(async () => { await changeLanguage('pt-BR') })
    expect(formatMainMessage(message)).toMatch(/search e fetch/)
    expect(formatMainMessage(message)).not.toMatch(/changed after you trusted/)
    expect(formatMainMessage(mainMessage('app.connectivity.offline', {}))).not.toBe('No network connection.')
  })

  it('word an MCP quarantine from its codes, and keep the reasons of a record that has none', async () => {
    expect(quarantineReasons(quarantine)).toEqual(['The description or inputs of "read" changed after you trusted it.', 'It added "write".'])
    expect(quarantineReasons({ ...quarantine, codes: undefined, reasons: ['Its command changed.'] })).toEqual(['Its command changed.'])
    await act(async () => { await changeLanguage('pt-BR') })
    const server = { name: 'files', trusted: false, tools: [], config: { transport: 'stdio', command: 'node', args: [], env: {} }, guard: { toolsRemembered: true, quarantine } } as unknown as McpServer
    render(<McpServerSafety server={server} />)
    const box = screen.getByTestId('mcp-quarantine')
    expect(box).toHaveTextContent('"read"')
    expect(box).not.toHaveTextContent('changed after you trusted it')
  })
})

describe('text built outside components', () => {
  it('renames the palette commands and their groups when the language changes, without a restart', async () => {
    const { result } = renderHook(() => useContributedCommands())
    const general = (): string | undefined => result.current.find(command => command.id === 'settings.general')?.title
    expect(general()).toBe('Settings: General')
    await act(async () => { await changeLanguage('pt-BR') })
    expect(general()).toBe('Configurações: Geral')
    expect(commandCategoryLabel('Help')).toBe('Ajuda')
    expect(commandCategoryLabel('OxeQuery')).toBe('OxeQuery')
  })

  it('names keyboard shortcuts from the catalog', async () => {
    expect(bindingLabel(getKeybinding('palette.open'))).toBe('Open command palette')
    await act(async () => { await changeLanguage('pt-BR') })
    expect(bindingLabel(getKeybinding('palette.open'))).not.toBe('Open command palette')
  })

  it('names a new OxePost request in the language on screen', async () => {
    useOxePostStore.getState().newRequest()
    expect(useOxePostStore.getState().draft.name).toBe('New request')
    await act(async () => { await changeLanguage('pt-BR') })
    useOxePostStore.getState().newRequest()
    expect(useOxePostStore.getState().draft.name).toBe('Nova requisição')
  })
})

describe('components in Brazilian Portuguese', () => {
  it('shows the terminal commands overlay in Portuguese', async () => {
    // jsdom has no layout; the overlay scrolls the selected row into view.
    Element.prototype.scrollIntoView = vi.fn()
    await act(async () => { await changeLanguage('pt-BR') })
    render(<SlashOverlay paneId="pane-1" paneLabel="Terminal 1" onClose={() => undefined} onExecute={() => undefined} />)
    expect(screen.getByPlaceholderText('Digite um comando…')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Comandos de Terminal 1' })).toBeInTheDocument()
    expect(screen.getByText('Limpa a tela do terminal (mantém a sessão).')).toBeInTheDocument()
  })
})
