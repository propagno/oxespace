import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToolsSettings } from '../src/components/Settings/ToolsSettings'
import { CONFIRM_LEVEL_TOOLS } from '../src/components/Settings/toolsModel'
import { changeLanguage } from '../src/i18n'
import type { PolicyView } from '../shared/policy'
import type { McpToolGroupInfo, McpToolGroupMode, McpToolGroupsReport, McpToolRule } from '../shared/types/mcp-tools'

const ROOT = 'C:/repo'
const cost = (chars: number, tokens: number) => ({ chars, tokens })
const group = (id: McpToolGroupInfo['id'], mode: McpToolGroupMode, tools: string[], extra: Partial<McpToolGroupInfo> = {}): McpToolGroupInfo => ({
  id, tools, mode, configurable: ['orchestration', 'data', 'docs', 'app'].includes(id), source: id === 'team' || id === 'worker' || id === 'code' ? 'role' : 'default',
  cost: { claude: { loaded: cost(1000 * tools.length, 417 * tools.length), deferred: cost(31 * tools.length, 13 * tools.length) }, codex: { loaded: cost(1000 * tools.length, 417 * tools.length) } },
  ...extra
})
function report(dataMode: McpToolGroupMode = 'off'): McpToolGroupsReport {
  return {
    rootPath: ROOT,
    groups: [
      group('core', 'always', ['oxespace_capabilities', 'oxespace_code_search']),
      group('orchestration', 'on-demand', ['oxespace_delegate_task']),
      group('data', dataMode, ['oxespace_db_connections', 'oxespace_db_execute'], dataMode === 'off' ? { source: 'project' } : { source: 'project' }),
      group('docs', 'always', ['oxespace_documentation_get']),
      group('app', 'on-demand', ['oxespace_git']),
      group('team', 'always', ['oxespace_team_status']),
      group('worker', 'always', ['oxespace_work_status']),
      group('code', 'always', ['oxespace_list_panes'])
    ],
    totals: { plainConversation: cost(12_345, 5_144), everythingOnDemand: cost(13_000, 5_417) }
  }
}
const POLICY: PolicyView = {
  problems: [],
  locations: [{ layer: 'managed', path: 'C:/ProgramData/OXESpace/policy.json' }],
  sources: [
    { layer: 'project', path: 'C:/repo/.oxespace/policy.json', rules: [{ effect: 'deny', action: 'tool.use', resource: 'mcp__oxespace-delegation__oxespace_git' }] },
    { layer: 'managed', path: 'C:/ProgramData/OXESpace/policy.json', organization: 'Acme', rules: [
      { effect: 'deny', action: 'integration.use', resource: 'mcp:github' },
      { effect: 'deny', action: 'provider.use', resource: 'codex' }
    ] }
  ]
}

function mount(options: { rules?: McpToolRule[]; dataMode?: McpToolGroupMode; noRules?: boolean; yaml?: { oxeYaml: McpToolGroupsReport['oxeYaml']; effectiveFrom?: string } } = {}) {
  let rules = options.rules ?? [{ server: 'github', tool: 'delete_repository', decision: 'deny', source: 'user', editable: false, allowedDecisions: [], confirmLevel: false, scope: 'everywhere' }]
  const api = {
    toolGroups: vi.fn(async () => ({ ...report(options.dataMode), ...options.yaml })),
    setToolGroupMode: vi.fn(async (input: { group: string; mode: McpToolGroupMode }) => report(input.group === 'data' ? input.mode : options.dataMode)),
    ...(options.noRules ? {} : {
      toolRules: vi.fn(async () => rules),
      setToolRule: vi.fn(async (input: { server: string; tool: string; decision: McpToolRule['decision'] }) => {
        rules = rules.filter(rule => !(rule.server === input.server && rule.tool === input.tool))
        if (input.decision !== 'ask') rules = [...rules, { server: input.server, tool: input.tool, decision: input.decision, source: 'project', editable: true, allowedDecisions: ['allow', 'ask', 'deny'], confirmLevel: false, scope: input.decision === 'deny' ? 'everywhere' : 'oxechat' }]
        return rules
      })
    })
  }
  const policy = { get: vi.fn(async () => POLICY) }
  ;(window as unknown as { oxe: unknown }).oxe = { mcpInternal: api, policy }
  render(<ToolsSettings rootPath={ROOT} workspaceId="ws-1" />)
  return { api, policy }
}

const panel = async (name: string) => screen.findByRole('region', { name })

afterEach(async () => { cleanup(); delete (window as { oxe?: unknown }).oxe; await changeLanguage('en') })

describe('Settings › Tools', () => {
  it('a broken oxe.yaml is said, its modes are not shown as known, and nothing offers to overwrite it (HML FINDING M on #210)', async () => {
    const { api } = mount({ dataMode: 'on-demand', yaml: { oxeYaml: 'invalid' } })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("oxe.yaml can't be read")
    expect(within(alert).getByText('oxe.yaml')).toHaveAttribute('title', ROOT)
    const data = await panel('Data')
    expect(within(data).getByText('Not read')).toBeVisible()
    expect(within(data).queryByText('On demand', { selector: 'span' })).toBeNull()
    for (const radio of within(data).getAllByRole('radio')) expect(radio).toBeDisabled()
    expect(within(data).getByText('Fix oxe.yaml to change this mode.')).toBeVisible()
    expect(api.setToolGroupMode).not.toHaveBeenCalled()
  })

  it('with the modes being enforced (effectiveFrom, BACKEND #372), a broken file shows them, says so, and still locks them', async () => {
    mount({ dataMode: 'off', yaml: { oxeYaml: 'invalid', effectiveFrom: 'last-valid' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Agents keep the last modes that could be read')
    const data = await panel('Data')
    expect(within(data).getByText('Off', { selector: 'span' })).toBeVisible()
    for (const radio of within(data).getAllByRole('radio')) expect(radio).toBeDisabled()
  })

  it('a valid file has no warning and its modes can be changed', async () => {
    mount({ yaml: { oxeYaml: 'valid', effectiveFrom: 'file' } })
    const data = await panel('Data')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(within(data).getAllByRole('radio').some(radio => !(radio as HTMLButtonElement).disabled)).toBe(true)
  })

  it('shows every group with its mode, where the mode comes from, and the costs from the contract', async () => {
    const { api, policy } = mount()
    expect(api.toolGroups).toHaveBeenCalledWith({ rootPath: ROOT })
    expect(policy.get).toHaveBeenCalledWith('ws-1')
    const data = await panel('Data')
    expect(within(data).getByText('Off', { selector: 'span' })).toBeVisible()
    expect(within(data).getByText('oxe.yaml')).toHaveAttribute('title', 'Set in the project\'s oxe.yaml (thread.tools).')
    expect(within(data).getAllByText('Not offered')).toHaveLength(3)
    const orchestration = await panel('Orchestration')
    // On demand, Claude's fixed cost is the names; loaded and Codex are the definitions (numbers straight from the contract).
    expect(within(orchestration).getByText('≈ 13 tokens · 31 characters')).toBeVisible()
    expect(within(orchestration).getByText('≈ 417 tokens · 1,000 characters')).toBeVisible()
    expect(within(orchestration).getByText('From the start; ≈ 417 tokens · 1,000 characters once used')).toBeVisible()
    const core = await panel('Core tools')
    expect(within(core).getAllByText('≈ 834 tokens · 2,000 characters')).toHaveLength(2)
    expect(within(core).queryByRole('radiogroup')).toBeNull()
    expect(screen.getByRole('radiogroup', { name: 'How Data is offered in this project' })).toBeVisible()
    expect(screen.getByText('≈ 5,144 tokens · 12,345 characters')).toBeVisible()
    for (const name of ['Team', 'Delegated task', 'OxeCode terminal']) {
      const role = await panel(name)
      expect(within(role).getByText('By role')).toBeVisible()
      expect(within(role).queryByRole('radiogroup')).toBeNull()
    }
  })

  it('says per provider how tools are offered, Codex having every group not off from the start', async () => {
    mount()
    expect(await screen.findByTestId('tools-codex-note')).toHaveTextContent('Codex Every group that is not off is available from the start; there is no turning a group on during a session.')
    expect(screen.getByRole('note', { name: 'How each provider gets the tools' })).toHaveTextContent('Claude Groups always on send their definitions with every request.')
  })

  it('turns a group on in the project through the contract and shows the new mode', async () => {
    const { api } = mount()
    const data = await panel('Data')
    // One control for the change: the segmented control (no separate "Turn on" button, #210 review L1).
    fireEvent.click(within(data).getByRole('radio', { name: 'On demand' }))
    await waitFor(() => expect(api.setToolGroupMode).toHaveBeenCalledWith({ rootPath: ROOT, group: 'data', mode: 'on-demand' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Data in this project: On demand.')
    expect(within(data).getByRole('radio', { name: 'On demand' })).toHaveAttribute('aria-checked', 'true')
    expect(within(data).queryByRole('button', { name: /Turn Data on/ })).toBeNull()
    fireEvent.click(within(data).getByRole('radio', { name: 'Always on' }))
    await waitFor(() => expect(api.setToolGroupMode).toHaveBeenLastCalledWith({ rootPath: ROOT, group: 'data', mode: 'always' }))
  })

  it('reports a refused mode change without changing what is shown', async () => {
    const { api } = mount()
    api.setToolGroupMode.mockRejectedValueOnce(new Error('This folder is not a project OXESpace knows'))
    const data = await panel('Data')
    fireEvent.click(within(data).getByRole('radio', { name: 'Always on' }))
    expect(await screen.findByText('Could not change the group')).toBeVisible()
    expect(within(data).getByRole('radio', { name: 'Off' })).toHaveAttribute('aria-checked', 'true')
  })

  it('blocks a tool through the contract, and asks before running one without asking', async () => {
    const { api } = mount()
    const orchestration = await panel('Orchestration')
    const select = await within(orchestration).findByRole('combobox', { name: 'Rule for oxespace_delegate_task' })
    fireEvent.change(select, { target: { value: 'deny' } })
    await waitFor(() => expect(api.setToolRule).toHaveBeenCalledWith({ rootPath: ROOT, server: 'oxespace-delegation', tool: 'oxespace_delegate_task', decision: 'deny' }))
    expect(await within(orchestration).findByText('Blocked everywhere: OxeChat conversations, OxeCode terminals and MCP.')).toBeInTheDocument()
    expect(within(orchestration).getByText('Rules per tool · 1 set')).toBeInTheDocument()

    fireEvent.change(select, { target: { value: 'allow' } })
    const dialog = await screen.findByRole('dialog', { name: 'Run oxespace_delegate_task without asking?' })
    expect(api.setToolRule).toHaveBeenCalledTimes(1)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run without asking' }))
    await waitFor(() => expect(api.setToolRule).toHaveBeenLastCalledWith({ rootPath: ROOT, server: 'oxespace-delegation', tool: 'oxespace_delegate_task', decision: 'allow' }))
    expect(await within(orchestration).findByText(/Runs without asking in OxeChat conversations/)).toBeInTheDocument()
  })

  it('does not offer running without asking for a tool you confirm each time, and keeps user rules read only', async () => {
    expect(CONFIRM_LEVEL_TOOLS.has('oxespace_db_execute')).toBe(true)
    expect(CONFIRM_LEVEL_TOOLS.has('oxespace_db_connections')).toBe(false)
    mount({ dataMode: 'on-demand' })
    const data = await panel('Data')
    const confirmLevel = await within(data).findByRole('combobox', { name: 'Rule for oxespace_db_execute' })
    expect(within(confirmLevel).queryByRole('option', { name: 'Run without asking' })).toBeNull()
    expect(within(confirmLevel).getByRole('option', { name: 'Block' })).toBeInTheDocument()
    expect(within(within(data).getByRole('combobox', { name: 'Rule for oxespace_db_connections' })).getByRole('option', { name: 'Run without asking' })).toBeInTheDocument()
    const others = await panel('Other MCP servers')
    expect(within(others).getByText('github · delete_repository')).toBeVisible()
    expect(within(others).getByRole('combobox', { name: 'Rule for delete_repository' })).toBeDisabled()
    expect(within(others).getByText('Set in your user policy; change it there.')).toBeVisible()
  })

  it('shows the organization policy about tools read only, without project rules', async () => {
    mount()
    const policy = await panel('User and organization policy')
    expect(await within(policy).findByText('mcp:github')).toBeVisible()
    expect(within(policy).getByText('Blocks')).toBeVisible()
    expect(within(policy).getByText('Managed by your organization · Acme')).toBeVisible()
    expect(within(policy).queryByText('codex')).toBeNull()
    expect(within(policy).queryByText(/oxespace_git/)).toBeNull()
    expect(within(policy).queryByRole('combobox')).toBeNull()
    expect(within(policy).queryByRole('button')).toBeNull()
  })

  it('still shows the groups when the rules cannot be read', async () => {
    mount({ noRules: true })
    expect(await panel('Data')).toBeVisible()
    expect(screen.getByText('Could not read the tool rules')).toBeVisible()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('reads in Portuguese', async () => {
    await act(async () => { await changeLanguage('pt-BR') })
    mount()
    const data = await panel('Dados')
    expect(within(data).queryByRole('button', { name: /Ligar/ })).toBeNull()
    expect(await panel('Essenciais')).toBeVisible()
    expect(await panel('Tarefa delegada')).toBeVisible()
    expect(within(data).getAllByText('Não oferecido')).toHaveLength(3)
    expect(screen.getByTestId('tools-codex-note')).toHaveTextContent('Todo grupo que não está desligado fica disponível desde o início')
    expect(within(await panel('Orquestração')).getByText('≈ 13 tokens · 31 caracteres')).toBeVisible()
  })
})
