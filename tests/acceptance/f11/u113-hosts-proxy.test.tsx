// Frozen acceptance test for 1.5.0 A68 / H4 on screen (DESIGN U11.3, OXE program, phase F11, task FE-A68). Written by
// the planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f11-design.md (U11.3 and the
// 08/11 update).
// Contract (BACKEND #724 @ ec177327): window.oxe.hostsProxy { state() → { enabled, state: 'running' | 'stopped' | 'failed',
// reason?: MainMessage (hostsProxy.portInUse { port } | hostsProxy.failed), hosts: [{ host, port, count, lastSeen, firstSeen,
// conversationId?, conversationTitle? }] }, setEnabled(on), clear(), retry(), onChanged(cb) }. The renderer part:
// HostsProxySettings({ onOpenConversation(id) }) in src/components/Settings/HostsProxySettings.tsx, the "Outgoing
// connections" section at the end of Settings › Agent activity. U11.3a's live curl and U11.3c (themes, axe) are e2e.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

type Row = Record<string, unknown>
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}
const NOW = Date.now()
const HOUR = 3_600_000
const HOSTS = [
  { host: 'api.example.com', port: 443, count: 4, lastSeen: NOW - 60_000, firstSeen: NOW - HOUR, conversationId: 't-pix', conversationTitle: 'Pix webhook' },
  { host: 'registry.npmjs.org', port: 443, count: 30, lastSeen: NOW - 2 * HOUR, firstSeen: NOW - 30 * 24 * HOUR },
  { host: 'localhost', port: 5432, count: 12, lastSeen: NOW - 5 * 60_000, firstSeen: NOW - HOUR }
]
function mockMain(state: Row = { enabled: true, state: 'running', hosts: HOSTS }) {
  let current = state
  const listeners: Array<() => void> = []
  const hostsProxy = {
    state: vi.fn(async () => current),
    setEnabled: vi.fn(async (on: boolean) => { current = { ...current, enabled: on }; for (const listener of listeners) listener() }),
    clear: vi.fn(async () => { current = { ...current, hosts: [] }; for (const listener of listeners) listener() }),
    retry: vi.fn(async () => undefined),
    onChanged: vi.fn((listener: () => void) => { listeners.push(listener); return () => undefined })
  }
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, hostsProxy } })
  return hostsProxy
}
async function renderSection() {
  const { HostsProxySettings } = await load<{ HostsProxySettings: (props: Row) => JSX.Element }>('src/components/Settings/HostsProxySettings')
  const onOpenConversation = vi.fn()
  render(<HostsProxySettings onOpenConversation={onOpenConversation} />)
  const toggle = await screen.findByRole('switch', { name: 'Log the hosts agents connect to' })
  return { toggle, onOpenConversation }
}
const rowOf = (host: string) => screen.getByText(host).closest('tr, [role="row"]') as HTMLElement

afterEach(async () => { cleanup(); await changeLanguage('en') })

describe('U11.3 · Outgoing hosts proxy', () => {
  test('off by default, with the help line that only hosts are logged', async () => {
    mockMain({ enabled: false, state: 'stopped', hosts: [] })
    const { toggle } = await renderSection()
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText('Only hosts are logged. Paths, headers and bodies never are.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  test('turning it on shows the one Callout under the switch, never a dialog', async () => {
    const main = mockMain({ enabled: false, state: 'stopped', hosts: [] })
    const { toggle } = await renderSection()
    await userEvent.click(toggle)
    expect(main.setEnabled).toHaveBeenCalledWith(true)
    expect(await screen.findByText('Applies to agents started from now on. Some tools ignore proxy settings, so the list can miss hosts.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('the list shows host and port only, newest first, From the conversation as a link or Outside a conversation', async () => {
    const props = await (async () => { mockMain(); return renderSection() })()
    const table = await screen.findByRole('table')
    const hosts = within(table).getAllByRole('row').slice(1).map(row => within(row).getAllByRole('cell')[0].textContent)
    expect(hosts).toEqual(['api.example.com', 'localhost', 'registry.npmjs.org'])
    expect(within(rowOf('api.example.com')).getByText('443')).toBeInTheDocument()
    await userEvent.click(within(rowOf('api.example.com')).getByRole('link', { name: 'Pix webhook' }))
    expect(props.onOpenConversation).toHaveBeenCalledWith('t-pix')
    expect(within(rowOf('registry.npmjs.org')).getByText('Outside a conversation')).toBeInTheDocument()
    expect(table.textContent).not.toMatch(/\/v1|\?|token=/)
  })

  test('a host first seen in the last 24 h gets New, except localhost', async () => {
    mockMain()
    await renderSection()
    await screen.findByRole('table')
    expect(within(rowOf('api.example.com')).getByText('New')).toBeInTheDocument()
    expect(within(rowOf('localhost')).queryByText('New')).toBeNull()
    expect(within(rowOf('registry.npmjs.org')).queryByText('New')).toBeNull()
  })

  test('Filter hosts narrows the list', async () => {
    mockMain()
    await renderSection()
    await screen.findByRole('table')
    await userEvent.type(screen.getByRole('textbox', { name: 'Filter hosts' }), 'npm')
    await waitFor(() => expect(screen.queryByText('api.example.com')).toBeNull())
    expect(screen.getByText('registry.npmjs.org')).toBeInTheDocument()
  })

  test('Clear the list confirms with Cancel focused, then empties it', async () => {
    const main = mockMain()
    await renderSection()
    await screen.findByRole('table')
    await userEvent.click(screen.getByRole('button', { name: 'Clear the list…' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(main.clear).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Clear the list…' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getAllByRole('button').find(button => button.textContent?.trim() !== 'Cancel')!)
    expect(main.clear).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('No outgoing connections yet.')).toBeInTheDocument()
  })

  test.each([
    [{ code: 'hostsProxy.portInUse', params: { port: 8899 } }, "The hosts proxy couldn't start: port 8899 is in use. Agents run without it."],
    [{ code: 'hostsProxy.failed', params: {} }, "The hosts proxy couldn't start. Agents run without it."]
  ])('a proxy that could not start shows one Notice (%j) with Try again', async (reason, line) => {
    const main = mockMain({ enabled: true, state: 'failed', reason, hosts: [] })
    await renderSection()
    expect(await screen.findByText(line as string)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(main.retry).toHaveBeenCalledTimes(1)
  })

  test('the section reads in pt-BR', async () => {
    await changeLanguage('pt-BR')
    mockMain({ enabled: true, state: 'failed', reason: { code: 'hostsProxy.portInUse', params: { port: 8899 } }, hosts: [HOSTS[1]] })
    const { HostsProxySettings } = await load<{ HostsProxySettings: (props: Row) => JSX.Element }>('src/components/Settings/HostsProxySettings')
    render(<HostsProxySettings onOpenConversation={vi.fn()} />)
    expect(await screen.findByRole('switch', { name: 'Registrar os hosts aos quais os agentes se conectam' })).toBeInTheDocument()
    expect(screen.getByText('O proxy de hosts não iniciou: a porta 8899 está em uso. Os agentes rodam sem ele.')).toBeInTheDocument()
    expect(screen.getByText('Fora de uma conversa')).toBeInTheDocument()
  })
})
