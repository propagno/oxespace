// Frozen acceptance test for 1.5.0 A55 / N4 on screen (DESIGN U7.4, OXE program, phase F7, task FE-AP4). Written by the
// planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f7-design.md (U7.4).
// Contract (BACKEND #714 §Contract): window.oxe.agentPermissions = { list({ workspaceId }) → { rules[{ id, provider, text, scope,
// project? }], databases[{ id, name, env, access: 'off' | 'read' | 'write' }] (BACKEND 08/11: 'write' is the
// level DESIGN calls "Read, ask before writing"; there is no fourth value), hosts[{ host, access: 'allowed' |
// 'ask' | 'blocked', callsToday, production, insecure }], policy[{ section, text }] }, revokeRule(id), setDatabaseAccess({ id,
// access }), setHostAccess({ workspaceId, host, access }) → { ok, undoToken? } | { ok: false, code }, undo(token), onChanged(cb) }.
// The renderer part: AgentPermissionsSettings({ workspaceId }) in src/components/Settings/AgentPermissionsSettings.tsx, the
// application page 'What agents can do' right after 'Approvals and safety' (APPLICATION_SETTINGS_PAGES, F3 FE-A7).
// This supersedes F3's "the application pages are listed in DESIGN's order" (u34-settings-pages): F7 adds one page there.
// U7.4d (a blocked host refused on the next call) is BACKEND's a55 test.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { changeLanguage } from '../../../src/i18n'

type Page = { id: string; label: string; hint?: string }
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}

const PAGE = {
  rules: [
    { id: 'rule-1', provider: 'claude', text: 'Bash(npm test:*)', scope: 'project', project: 'C:\\work\\shop' },
    { id: 'rule-2', provider: 'codex', text: 'npm run build', scope: 'session' }
  ],
  databases: [{ id: 'c-dev', name: 'shop', env: 'dev', access: 'read' }, { id: 'c-prod', name: 'shop-prod', env: 'production', access: 'read' }],
  hosts: [
    { host: 'api.example.com', access: 'allowed', callsToday: 4, production: false, insecure: false },
    { host: 'api.prod.example', access: 'ask', callsToday: 1, production: true, insecure: false }
  ],
  policy: [{ section: 'hosts', text: 'deny *.bank.example' }]
}
function mockMain(page: Record<string, unknown> = PAGE) {
  const changed: Array<() => void> = []
  const agentPermissions = {
    list: vi.fn(async () => page),
    revokeRule: vi.fn(async () => ({ ok: true, undoToken: 'tok-rule' })),
    setDatabaseAccess: vi.fn(async () => ({ ok: true, undoToken: 'tok-db' })),
    setHostAccess: vi.fn(async () => ({ ok: true, undoToken: 'tok-host' })),
    undo: vi.fn(async () => ({ ok: true })),
    onChanged: vi.fn((listener: () => void) => { changed.push(listener); return () => undefined })
  }
  Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, agentPermissions } })
  return { agentPermissions, change: () => act(() => { for (const listener of changed) listener() }) }
}
async function renderPage() {
  const { AgentPermissionsSettings } = await load<{ AgentPermissionsSettings: (props: { workspaceId: string }) => JSX.Element }>('src/components/Settings/AgentPermissionsSettings')
  const { Toaster } = await import('../../../src/ui/Toast')
  render(<><AgentPermissionsSettings workspaceId="ws-1" /><Toaster /></>)
  await screen.findByRole('heading', { name: 'What agents can do' })
}
const section = (name: string) => screen.getByRole('region', { name })

afterEach(async () => { cleanup(); localStorage.clear(); await changeLanguage('en') })

describe('U7.4 · What agents can do', () => {
  test("What agents can do follows Approvals and safety in Settings, and the search finds it for databases and hosts", async () => {
    const { APPLICATION_SETTINGS_PAGES, searchSettingsPages } = await import('../../../src/components/Settings/SettingsCenter') as unknown as { APPLICATION_SETTINGS_PAGES: readonly Page[]; searchSettingsPages: (query: string) => Page[] }
    const labels = APPLICATION_SETTINGS_PAGES.map(page => page.label)
    expect(labels.indexOf('What agents can do')).toBe(labels.indexOf('Approvals and safety') + 1)
    expect(searchSettingsPages('databases').map(page => page.label)).toContain('What agents can do')
    expect(searchSettingsPages('hosts').map(page => page.label)).toContain('What agents can do')
    expect(searchSettingsPages('databases').map(page => page.label)).not.toContain('Approvals and safety')
  })

  test('the page reads its description and four sections in order', async () => {
    mockMain()
    await renderPage()
    expect(screen.getByText('Everything agents may do without asking. Revoke anything here.')).toBeInTheDocument()
    const order = ['Always allowed commands', 'Databases', 'HTTP hosts', 'Always on'].map(section)
    for (let index = 1; index < order.length; index++) {
      expect(order[index - 1].compareDocumentPosition(order[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  test('each always-allowed rule shows its provider and scope; Revoke gives an undo that calls main back', async () => {
    const main = mockMain()
    await renderPage()
    const rules = section('Always allowed commands')
    expect(await within(rules).findByText('Bash(npm test:*)')).toBeInTheDocument()
    expect(within(rules).getByText('Claude Code · shop · project rule')).toBeInTheDocument()
    expect(within(rules).getByText('Codex · this session only')).toBeInTheDocument()
    await userEvent.click(within(rules).getAllByRole('button', { name: 'Revoke' })[0])
    expect(main.agentPermissions.revokeRule).toHaveBeenCalledWith('rule-1')
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(main.agentPermissions.undo).toHaveBeenCalledWith('tok-rule')
  })

  test('with no rules the section says so', async () => {
    mockMain({ ...PAGE, rules: [] })
    await renderPage()
    expect(await within(section('Always allowed commands')).findByText('No commands are always allowed.')).toBeInTheDocument()
  })

  test('a database row offers Nothing, Read, and Read, ask before writing; a production one only Nothing and Read; widening gives an undo', async () => {
    const main = mockMain()
    await renderPage()
    const databases = section('Databases')
    const dev = await within(databases).findByRole('combobox', { name: /^shop\b/ })
    expect(within(dev).getAllByRole('option').map(option => option.textContent)).toEqual(['Nothing', 'Read', 'Read, ask before writing'])
    const prod = within(databases).getByRole('combobox', { name: /shop-prod/ })
    expect(within(prod).getAllByRole('option').map(option => option.textContent)).toEqual(['Nothing', 'Read'])
    await userEvent.selectOptions(dev, 'Read, ask before writing')
    expect(main.agentPermissions.setDatabaseAccess).toHaveBeenCalledWith({ id: 'c-dev', access: 'write' })
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(main.agentPermissions.undo).toHaveBeenCalledWith('tok-db')
  })

  test('a host row shows its calls today and flags, and its select sets Allowed, Ask first or Blocked', async () => {
    const main = mockMain()
    await renderPage()
    const hosts = section('HTTP hosts')
    expect(await within(hosts).findByText('api.example.com')).toBeInTheDocument()
    expect(within(hosts).getByText(/4 calls today/)).toBeInTheDocument()
    expect(within(hosts).getByText(/1 call today · production/)).toBeInTheDocument()
    const select = within(hosts).getByRole('combobox', { name: /api\.example\.com/ })
    expect(within(select).getAllByRole('option').map(option => option.textContent)).toEqual(['Allowed', 'Ask first', 'Blocked'])
    await userEvent.selectOptions(select, 'Blocked')
    expect(main.agentPermissions.setHostAccess).toHaveBeenCalledWith({ workspaceId: 'ws-1', host: 'api.example.com', access: 'blocked' })
  })

  test('Policy rows are read only, say they come from policy.yaml, and open in the editor', async () => {
    mockMain()
    await renderPage()
    const hosts = section('HTTP hosts')
    const row = (await within(hosts).findByText('deny *.bank.example')).closest('li, [role="listitem"], [role="row"]') as HTMLElement
    expect(within(row).getByText('From policy.yaml')).toBeInTheDocument()
    expect(within(row).queryByRole('combobox')).toBeNull()
    expect(within(row).queryByRole('button', { name: 'Revoke' })).toBeNull()
    expect(within(row).getByRole('button', { name: 'Open in editor' })).toBeInTheDocument()
  })

  test('Always on is text only', async () => {
    mockMain()
    await renderPage()
    const always = section('Always on')
    expect(within(always).getByText('Agents never write to production.')).toBeInTheDocument()
    expect(within(always).getByText('Deny is the default, and irreversible approvals need a hold.')).toBeInTheDocument()
    expect(within(always).queryAllByRole('button')).toEqual([])
    expect(within(always).queryAllByRole('combobox')).toEqual([])
  })

  test('a change from main (a rule added from a card) refreshes the page', async () => {
    const main = mockMain()
    await renderPage()
    await within(section('Always allowed commands')).findByText('Bash(npm test:*)')
    main.agentPermissions.list.mockResolvedValueOnce({ ...PAGE, rules: [...PAGE.rules, { id: 'rule-3', provider: 'claude', text: 'Bash(npm run lint:*)', scope: 'project', project: 'C:\\work\\shop' }] })
    main.change()
    await waitFor(() => expect(within(section('Always allowed commands')).getByText('Bash(npm run lint:*)')).toBeInTheDocument())
  })

  test('the page reads in pt-BR', async () => {
    await changeLanguage('pt-BR')
    mockMain()
    const { AgentPermissionsSettings } = await load<{ AgentPermissionsSettings: (props: { workspaceId: string }) => JSX.Element }>('src/components/Settings/AgentPermissionsSettings')
    render(<AgentPermissionsSettings workspaceId="ws-1" />)
    expect(await screen.findByRole('heading', { name: 'O que os agentes podem fazer' })).toBeInTheDocument()
    expect(screen.getByText('Tudo o que os agentes podem fazer sem perguntar. Revogue o que quiser aqui.')).toBeInTheDocument()
    for (const name of ['Comandos sempre permitidos', 'Bancos de dados', 'Hosts HTTP', 'Sempre ativo']) expect(screen.getByRole('region', { name })).toBeInTheDocument()
    expect(await screen.findByText('Do policy.yaml')).toBeInTheDocument()
    expect(screen.getByText('Agentes nunca escrevem em produção.')).toBeInTheDocument()
  })

  test('Approvals and safety no longer shows a Databases section or any per-connection access control', async () => {
    const deep = (): unknown => new Proxy(async () => undefined, { get: (_target, key) => key === 'then' ? undefined : deep() })
    Object.assign(window, { oxe: deep() })
    const center = await import('../../../src/components/Settings/SettingsCenter') as unknown as { APPLICATION_SETTINGS_PAGES: readonly Page[]; SettingsCenter: (props: Record<string, unknown>) => JSX.Element }
    const page = center.APPLICATION_SETTINGS_PAGES.find(entry => entry.label === 'Approvals and safety')
    expect(page, 'the Approvals and safety page').toBeTruthy()
    render(<center.SettingsCenter initialPage={page!.id} workspaces={[]} shellProfiles={[]} onSave={vi.fn()} onClose={vi.fn()}
      agentProfiles={[]} agentReadiness={[]} isDiscoveringAgents={false} onDiscoverAgents={vi.fn()} onConfigureAgent={vi.fn()} onNewCustomAgent={vi.fn()} />)
    const heading = await screen.findByRole('heading', { name: 'Approvals and safety' }, { timeout: 10_000 })
    const pageBody = (heading.closest('section') ?? document.body) as HTMLElement
    expect(within(pageBody).queryByRole('heading', { name: /^Databases$/ })).toBeNull()
    expect(within(pageBody).queryByRole('region', { name: /^Databases$/ })).toBeNull()
    expect(within(pageBody).queryAllByRole('option').map(option => option.textContent)).not.toContain('Read, ask before writing')
    expect(pageBody.textContent).not.toMatch(/Read, ask before writing|Read and write/)
  }, 30_000)

})
