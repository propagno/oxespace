import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { McpToolGroupInfo } from '../../../shared/types/mcp-tools'
import { changeLanguage } from '../../../src/i18n'
import { ThreadIntegratedTools } from '../../../src/components/Threads/ThreadIntegratedTools'
import { ThreadMcpServerList } from '../../../src/components/Threads/ThreadMcpServerList'
import { useUIStore } from '../../../src/store/ui.store'

// OXE-377 (Heavy User, parts 1 and 2): OXESpace's own MCP server showed only as "oxespace-delegation", with no groups
// and no way to its settings; in the MCP servers modal the built-in card's chevron sat under Regenerate token.

const cost = { claude: { loaded: { chars: 0, tokens: 0 }, deferred: { chars: 0, tokens: 0 } }, codex: { loaded: { chars: 0, tokens: 0 } } }
const group = (id: McpToolGroupInfo['id'], mode: McpToolGroupInfo['mode'], configurable = true): McpToolGroupInfo => ({ id, tools: [], mode, source: 'default', configurable, cost })

describe('OXE-377 · OXESpace (Integrated) in the session panel', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'oxe', { configurable: true, value: { mcpInternal: { toolGroups: vi.fn(async () => ({ groups: [
      group('core', 'always', false), group('orchestration', 'on-demand'), group('data', 'off'), group('preview', 'always'), group('app', 'on-demand'), group('docs', 'on-demand')
    ] })) } } })
    useUIStore.setState({ isSettingsOpen: false, settingsInitialPage: undefined })
  })
  afterEach(async () => { cleanup(); await changeLanguage('en') })

  test('names the server, says it is on in this session, lists each group with its mode, and opens Settings › Tools', async () => {
    render(<ThreadIntegratedTools rootPath="C:/repo" servers={[{ name: 'oxespace-delegation', status: 'connected' }]} />)
    const section = screen.getByRole('region', { name: 'OXESpace (Integrated)' })
    expect(within(section).getByText('On in this session')).toBeInTheDocument()
    const list = await within(section).findByRole('list', { name: 'OXESpace tool groups' })
    const rows = within(list).getAllByRole('listitem').map(item => item.textContent)
    expect(rows).toEqual(['OrchestrationOn demand', 'DataOff', 'PreviewAlways on', 'AppOn demand', 'DocumentationOn demand'])
    expect(window.oxe.mcpInternal.toolGroups).toHaveBeenCalledWith({ rootPath: 'C:/repo' })
    fireEvent.click(within(section).getByRole('button', { name: 'Configure tools' }))
    expect(useUIStore.getState()).toMatchObject({ isSettingsOpen: true, settingsInitialPage: 'mcp' })
  })

  test('in pt-BR it reads "OXESpace (Integrado)"', async () => {
    await changeLanguage('pt-BR')
    render(<ThreadIntegratedTools rootPath="C:/repo" servers={[{ name: 'oxespace-delegation', status: 'connected' }]} />)
    expect(screen.getByRole('region', { name: 'OXESpace (Integrado)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Configurar ferramentas' })).toBeInTheDocument()
  })

  test('the session\'s MCP list says OXESpace (Integrated), not oxespace-delegation', () => {
    render(<ThreadMcpServerList servers={[{ name: 'oxespace-delegation', status: 'connected' }, { name: 'github', status: 'connected' }]} />)
    expect(screen.getByText('OXESpace (Integrated)')).toBeInTheDocument()
    expect(screen.queryByText('oxespace-delegation')).toBeNull()
    expect(screen.getByText('github')).toBeInTheDocument()
  })
})

describe('OXE-377 · the built-in card keeps Regenerate token clear of the chevron', () => {
  test('[css] Regenerate token has its own column, not placed over the main button', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/mcp.css'), 'utf8')
    const row = /\.mcp-builtin-row\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(row).toMatch(/display:\s*grid/)
    expect(row).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/)
    const regen = [...css.matchAll(/\.mcp-builtin-row \.mcp-builtin-regen\s*\{([^}]*)\}/g)].map(match => match[1]).join(' ')
    expect(regen).not.toMatch(/position:\s*absolute/)
    expect(css).toMatch(/\.mcp-builtin-row\.expanded\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/)
  })
})
