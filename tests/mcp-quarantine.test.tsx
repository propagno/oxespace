import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServer } from '../shared/types/mcp'
import { quarantineFixtureServers } from '../electron/main/e2e/mcp-fixture'
import { McpPanel } from '../src/components/MCP/McpPanel'
import { quarantinedCount } from '../src/components/MCP/mcpQuarantine'
import { useMcpQuarantineActivity } from '../src/hooks/useMcpQuarantineActivity'
import { openActivityTarget } from '../src/components/Activity/openActivityTarget'
import { useActivityStore } from '../src/store/activity.store'
import { useMcpStore } from '../src/store/mcp.store'
import { useUIStore } from '../src/store/ui.store'
import { changeLanguage, i18n } from '../src/i18n'

let servers: McpServer[]
const update = vi.fn(async (input: { id: string; trusted?: boolean }) => {
  const server = servers.find(item => item.id === input.id)!
  if (input.trusted) Object.assign(server, { trusted: true, guard: { toolsRemembered: true, quarantine: null } })
  return { ...server }
})
const test = vi.fn(async (id: string) => ({ ...servers.find(item => item.id === id)!, health: 'healthy' as const }))

beforeEach(() => {
  servers = quarantineFixtureServers()
  update.mockClear(); test.mockClear()
  useMcpStore.setState({ serversByWorkspace: {}, loading: false, error: null })
  useActivityStore.setState({ items: [] })
  window.oxe = { ...window.oxe, mcp: { ...(window.oxe?.mcp ?? {}), list: vi.fn(async () => servers.map(item => ({ ...item }))), update, test }, mcpInternal: { getStatus: vi.fn(async () => null) } } as unknown as typeof window.oxe
})
afterEach(async () => { cleanup(); await changeLanguage('en') })

async function openInstalled(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup()
  render(<McpPanel workspaceId={null} onClose={vi.fn()} />)
  await user.click(await screen.findByRole('tab', { name: /Installed/ }))
  await screen.findByText('docs-search')
  return user
}

describe('MCP quarantine', () => {
  it('the Installed tab counts the quarantined servers, and each row has an alert chip, not a neutral tag', async () => {
    await openInstalled()
    expect(screen.getByTestId('mcp-installed-quarantined')).toHaveTextContent('2 quarantined')
    expect(screen.getAllByTestId('mcp-quarantine-chip')).toHaveLength(2)
    expect(screen.getAllByTestId('mcp-quarantine-chip')[0]).toHaveClass('is-quarantined')
    expect(screen.getAllByTestId('mcp-quarantine-chip')[0].querySelector('svg')).not.toBeNull()
  })

  it('a quarantined server offers "Trust again…" instead of Test; the never-trusted one keeps Test and its inline question', async () => {
    await openInstalled()
    expect(screen.getByRole('button', { name: 'Trust docs-search again' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trust deploy-helper again' })).toBeInTheDocument()
    // Test exists for new-server and notes only.
    expect(screen.getAllByRole('button', { name: /^Test$/ })).toHaveLength(2)
  })

  it('Trust again asks first, with what changed and Cancel focused; Cancel trusts nothing', async () => {
    const user = await openInstalled()
    await user.click(screen.getByRole('button', { name: 'Trust docs-search again' }))
    const dialog = await screen.findByTestId('mcp-trust-again')
    expect(within(dialog).getByRole('heading', { name: 'Trust docs-search again?' })).toBeInTheDocument()
    expect(within(dialog).getByTestId('mcp-quarantine')).toHaveTextContent('upload_file')
    expect(within(dialog).getByTestId('mcp-description-warning')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByTestId('mcp-trust-again')).toBeNull())
    expect(update).not.toHaveBeenCalled()
    expect(test).not.toHaveBeenCalled()
  })

  it('confirming trusts it again and tests it; the chip, the counter and the button go away', async () => {
    const user = await openInstalled()
    await user.click(screen.getByRole('button', { name: 'Trust docs-search again' }))
    await user.click(within(await screen.findByTestId('mcp-trust-again')).getByRole('button', { name: 'Trust again and test' }))
    await waitFor(() => expect(screen.queryByTestId('mcp-trust-again')).toBeNull())
    expect(update).toHaveBeenCalledWith({ id: 'fixture-docs-search', trusted: true })
    expect(test).toHaveBeenCalledWith('fixture-docs-search')
    expect(screen.queryByRole('button', { name: 'Trust docs-search again' })).toBeNull()
    expect(screen.getByTestId('mcp-installed-quarantined')).toHaveTextContent('1 quarantined')
  })

  it('"No tools" in both languages instead of "0 tools", which pt-BR would make singular', async () => {
    expect(i18n.t('mcp.tools', { ns: 'code', count: 0 })).toBe('No tools')
    expect(i18n.t('mcp.tools', { ns: 'code', count: 1 })).toBe('1 tool')
    await changeLanguage('pt-BR')
    expect(i18n.t('mcp.tools', { ns: 'code', count: 0 })).toBe('Nenhuma ferramenta')
    expect(i18n.t('mcp.tools', { ns: 'code', count: 2 })).toBe('2 ferramentas')
    expect(i18n.t('mcp.quarantinedCount', { ns: 'code', count: 2 })).toBe('2 em quarentena')
  })
})

describe('MCP quarantine in the activity center', () => {
  it('records each quarantine once as "needs you", drops it once trusted again, and opens the MCP panel', () => {
    renderHook(() => useMcpQuarantineActivity())
    act(() => useMcpStore.setState({ serversByWorkspace: { __global__: servers.map(item => ({ ...item })) } }))
    const items = useActivityStore.getState().items
    expect(items.map(item => [item.source, item.id, item.kind])).toEqual(expect.arrayContaining([['mcp', 'fixture-docs-search', 'needs-you'], ['mcp', 'fixture-deploy-helper', 'needs-you']]))
    expect(items).toHaveLength(2)
    expect(items.find(item => item.id === 'fixture-docs-search')?.title).toBe('docs-search is quarantined')

    // The same quarantine seen again (another workspace's list, a reload) is not a new entry.
    useActivityStore.getState().markRead('mcp', 'fixture-docs-search')
    act(() => useMcpStore.setState({ serversByWorkspace: { __global__: servers.map(item => ({ ...item })), ws1: servers.map(item => ({ ...item })) } }))
    expect(useActivityStore.getState().items.find(item => item.id === 'fixture-docs-search')?.read).toBe(true)

    const trusted = servers.map(item => item.id === 'fixture-docs-search' ? { ...item, trusted: true, guard: { toolsRemembered: true, quarantine: null } } : { ...item })
    act(() => useMcpStore.setState({ serversByWorkspace: { __global__: trusted } }))
    expect(useActivityStore.getState().items.map(item => item.id)).toEqual(['fixture-deploy-helper'])
    // Removed: gone too.
    act(() => useMcpStore.setState({ serversByWorkspace: { __global__: trusted.filter(item => item.id !== 'fixture-deploy-helper') } }))
    expect(useActivityStore.getState().items).toEqual([])

    const openMcpPanel = vi.spyOn(useUIStore.getState(), 'openMcpPanel')
    openActivityTarget({ type: 'mcp', serverId: 'fixture-docs-search' }, vi.fn())
    expect(openMcpPanel).toHaveBeenCalled()
  })

  it('counts quarantined servers', () => {
    expect(quarantinedCount(servers)).toBe(2)
    expect(quarantinedCount([])).toBe(0)
  })
})
