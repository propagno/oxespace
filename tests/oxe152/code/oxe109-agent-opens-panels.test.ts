// Frozen acceptance test for 1.5.2 OxeCode F3 (OXE program oxespace-152-code, phase F3, Jira OXE-109).
// Written by the planner; the executor must not edit it.
// Defect (real use, 13/11): when the agent asks for the Web Preview or the Android device, the app only queues the
// request and the person has to find and open the panel. An external URL waits up to 45 s in the approvals center with
// the panel closed (open_web_preview runs gated, "confirm", electron/main/mcp-internal/tool-handlers.ts:304-305; the
// broker's wait, agent-actions/approval-broker.ts:72), and the panel then says "turn on External preview"; App.tsx
// (~line 376) opens the event's workspace Browser but neither brings OxeCode to the front nor selects that workspace;
// device_screenshot with "Agents can see" off only tells the agent to ask the person.
// Coordination answer OXE-109/Q-4 ("aprovação única e auditável"): one approval, one audit trail. The confirmation of an
// external page stays the approval center's own record (the one approvals:list returns and the approvals center shows);
// the panel shows that same record inline and answers it there. Per-workspace permission is the existing "What agents
// can do" host access (AgentPermissions, electron/main/services/approvals/agent-permissions.ts; IPC agentPermissions.*).
// Contract:
// - open_web_preview, a local page (localhost / 127.0.0.1): emits the preview event at once, no approval (as today).
// - open_web_preview, an external page:
//   * asks activeHostDecision(rootPath, host) first (agent-permissions.ts:176). 'deny' (the host is blocked for this
//     workspace in Settings › What agents can do, or a policy denies it): refused, no approval record, nothing emitted,
//     and the agent is told where the person can change it. Any other decision asks (RT-1: the store's default for an
//     unknown host is 'allowed', so it cannot mean the person allowed the page).
//   * asks through ctx.agentActions as today (level confirm; the AgentActions -> ApprovalBroker -> centerApprovalPrompter
//     -> ApprovalCenter.ask path), so the record is the center's own: summary approvals.summary.mcpConfirm with tool
//     oxespace_open_web_preview, agentText naming the URL.
//   * as soon as that record exists (ApprovalCenter.ask's onAsked, carried up through the prompter, the broker and
//     AgentActions), emits the preview event with `permission: 'ask'` and `approvalId: <the record's id>`
//     (InternalMcpWebPreviewEvent, shared/types/mcp-internal.ts, gains both), so the panel opens while the agent waits.
//   * the person's Allow on that record (wherever answered) loads the page: a second preview event for the URL, without
//     `permission`; Deny loads nothing and the agent gets the refusal. The center's history holds the one decision.
// - src/app/agentPreview.ts, a thin facade (no state of its own):
//   * openAgentPreview(event, app), app = { view: AppView; activeWorkspaceId: string | null; showCode(): void;
//     activateWorkspace(id: string): void }; App.tsx's onWebPreview listener calls it. A Code (workspace) event opens that
//     workspace's Browser, brings OxeCode to the front when another view shows and selects the workspace when another one
//     is active. A local page goes to ui.pendingWebPreviewByWorkspace (the panel loads it); an event with permission
//     'ask' does not (nothing loads before the OK).
//   * previewApprovalFor(owner: { threadId?: string; paneIds: readonly string[] }, queue: readonly ApprovalRequest[]):
//     the pending record of oxespace_open_web_preview raised by that owner's agent (requester id `pane:<id>` or
//     `thread:<id>`), or null.
// - src/components/WebPreview/PreviewApprovalInline.tsx exports PreviewApprovalInline({ owner }): reads the approvals
//   store (src/components/Approvals/approvals.store.ts, the queue the approvals center lists), shows that record inline
//   (its URL and its own options) and answers it with useApprovalsStore.respond over approvalsApi(); WebPreviewPanel
//   renders it.
// - Android: ToolContext gains `openAndroidPanel?(request: { workspaceId: string; serial: string }): void`, passed by
//   bootstrap/local RPC and wired in index.ts to broadcast IPC_CHANNELS.android.openPanel ('android:open-panel').
//   device_screenshot with "Agents can see" off calls it and tells the agent the panel was opened for the person.
//   ui.store gains openAndroidPanel(), which opens the panel and keeps it open (a toggle would close it).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/user-data', getAppPath: () => '/app', isPackaged: false, getVersion: () => '1.5.2' }, BrowserWindow: { getAllWindows: () => [] } }))

await import('../../../electron/main/mcp-internal/tool-registry')
const { handlers } = await import('../../../electron/main/mcp-internal/tool-handlers')
const { AgentActions } = await import('../../../electron/main/services/agent-actions/agent-actions')
const { ApprovalBroker } = await import('../../../electron/main/services/agent-actions/approval-broker')
const { centerApprovalPrompter } = await import('../../../electron/main/services/agent-actions/approval-prompter')
const { ApprovalCenter } = await import('../../../electron/main/services/approvals/approval-center')
const { AgentPermissions, setActiveAgentPermissions } = await import('../../../electron/main/services/approvals/agent-permissions')
const { ExecutionRegistry } = await import('../../../electron/main/services/execution-registry')
const { AndroidAgentAccess, AndroidDevices } = await import('../../../electron/main/services/android/android-devices')
const { IPC_CHANNELS } = await import('../../../shared/types/ipc')
const { useUIStore } = await import('../../../src/store/ui.store')
const { useApprovalsStore } = await import('../../../src/components/Approvals/approvals.store')
const { installApprovalsMock } = await import('../../../src/components/Approvals/approvalsMock')
const { resetApprovalsApi } = await import('../../../src/components/Approvals/approvalsApi')
const { changeLanguage } = await import('../../../src/i18n')
const { mainMessage } = await import('../../../shared/messages')

type Result = { content: Array<{ type: string; text?: string }>; isError?: boolean }
type Emitted = Record<string, unknown>
const textOf = (result: Result): string => result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
const EXTERNAL = 'https://example.com/docs'

/** The app's approval center, its broker and an agent execution in pane p1 of workspace w1. */
function agentContext(waitMs = 10_000) {
  const center = new ApprovalCenter({ send: () => undefined, hasWindow: () => true, native: () => new Promise<string | null>(() => undefined), ackTimeoutMs: 600_000 })
  const broker = new ApprovalBroker(centerApprovalPrompter(center), Date.now, waitMs, () => () => undefined)
  const executions = new ExecutionRegistry()
  const env = executions.register({ owner: { kind: 'pane', id: 'p1' }, workspaceId: 'w1', cwd: process.cwd() })
  const emitted: Emitted[] = []
  const ctx = {
    workspaceId: 'w1', executionId: env.OXESPACE_EXECUTION_ID, executionToken: env.OXESPACE_EXECUTION_TOKEN, executions,
    workspaceServ: { get: (id: string) => id === 'w1' ? { id: 'w1', name: 'site', rootPath: process.cwd(), panes: [{ id: 'p1', type: 'terminal' }] } : undefined, list: () => [] },
    agentActions: new AgentActions({ broker }),
    webPreview: { emitPreview: (event: Emitted) => { emitted.push(event) } }
  }
  /** Denies whatever is still waiting, so a call never outlives its test. */
  const settleAll = (): void => { for (const request of center.list()) center.respond({ id: request.id, generation: request.generation, optionId: request.defaultOptionId }) }
  return { ctx: ctx as never, center, broker, emitted, settleAll }
}

/** The existing "What agents can do" model, with an in-memory host source. */
function hostPermissions() {
  const saved = new Map<string, string>()
  const permissions = new AgentPermissions({
    alwaysAllow: { list: () => [], revoke: () => ({ ok: true }) } as never,
    databases: { list: () => [], setAccess: () => undefined },
    hosts: { observed: () => [], get: (workspaceId, host) => (saved.get(`${workspaceId}|${host}`) ?? 'allowed') as never, set: (workspaceId, host, access) => { saved.set(`${workspaceId}|${host}`, access) } },
    policy: () => []
  })
  setActiveAgentPermissions({ permissions, workspaceForRoot: root => root === process.cwd() ? 'w1' : undefined })
  return permissions
}

async function facade() {
  // Resolved at run time: the module is the contract this card creates.
  const path = '../../../src/app/agentPreview'
  return (await import(/* @vite-ignore */ path)) as {
    openAgentPreview(event: Record<string, unknown>, app: Record<string, unknown>): void
    previewApprovalFor(owner: { threadId?: string; paneIds: readonly string[] }, queue: readonly unknown[]): { id: string } | null
  }
}

async function inline() {
  const path = '../../../src/components/WebPreview/PreviewApprovalInline'
  return (await import(/* @vite-ignore */ path)) as { PreviewApprovalInline(props: { owner: { threadId?: string; paneIds: readonly string[] } }): unknown }
}

/** A pending record as the center raises it for open_web_preview, plus an unrelated one. */
function raisePreviewApproval(hook: ReturnType<typeof installApprovalsMock>['hook']): string {
  hook.request({ id: 'other-1', kind: 'mcp-confirm', summary: mainMessage('approvals.summary.mcpConfirm', { tool: 'oxespace_git_change', action: 'call', target: 'C:\\repo' }) })
  return hook.request({
    id: 'preview-approval-1', kind: 'mcp-confirm', risk: 'medium', target: EXTERNAL,
    requester: { kind: 'agent', id: 'pane:p1', label: mainMessage('approvals.requester.pane', { agent: 'Claude', pane: 1 }) },
    summary: mainMessage('approvals.summary.mcpConfirm', { tool: 'oxespace_open_web_preview', action: 'call', target: EXTERNAL }),
    agentText: `Open in the Web Preview:\n${EXTERNAL}`,
    options: [{ id: 'deny', intent: 'deny', label: mainMessage('approvals.option.deny', {}) }, { id: 'allow-once', intent: 'allow', label: mainMessage('approvals.option.allowOnce', {}) }]
  })
}

const resetWindow = (): void => {
  useUIStore.setState({ pendingWebPreviewByWorkspace: {}, webPreviewOpenByWorkspace: {}, isAndroidPanelOpen: false } as never)
  useApprovalsStore.getState().reset()
  resetApprovalsApi()
}

describe('OXE-109 main · what the agent asks for reaches the panels at once', () => {
  afterEach(() => { setActiveAgentPermissions(null) })

  it('CA-1 · a localhost page of the workspace opens at once, with no confirmation', async () => {
    const { ctx, center, emitted } = agentContext()
    const result = await handlers.openWebPreview({ url: 'http://127.0.0.1:5180/' }, ctx) as Result
    expect(result.isError).toBeFalsy()
    expect(center.list()).toEqual([])
    expect(emitted).toEqual([expect.objectContaining({ workspaceId: 'w1', url: 'http://127.0.0.1:5180/' })])
    expect(emitted[0].permission).toBeUndefined()
  })

  it('CA-2 · an external URL raises the approval center\'s own record and opens the panel on it; Allow loads the page', async () => {
    const { ctx, center, emitted, settleAll } = agentContext()
    const call = handlers.openWebPreview({ url: EXTERNAL }, ctx) as Promise<Result>
    try {
      await vi.waitFor(() => expect(center.list()).toHaveLength(1))
      const record = center.list()[0]
      expect(record.summary).toMatchObject({ code: 'approvals.summary.mcpConfirm', params: expect.objectContaining({ tool: 'oxespace_open_web_preview' }) })
      expect(record.agentText.text).toContain(EXTERNAL)
      // The panel opens on that record while the agent waits; nothing is loaded yet.
      await vi.waitFor(() => expect(emitted).toEqual([expect.objectContaining({ workspaceId: 'w1', url: EXTERNAL, permission: 'ask', approvalId: record.id })]))
      expect(center.ack({ id: record.id, generation: record.generation, visible: true, focused: true })).toMatchObject({ ok: true })
      const allow = record.options.find(option => option.intent === 'allow')!
      expect(center.respond({ id: record.id, generation: record.generation, optionId: allow.id })).toMatchObject({ ok: true })
      const result = await call
      expect(result.isError).toBeFalsy()
      expect(emitted).toHaveLength(2)
      expect(emitted[1]).toMatchObject({ workspaceId: 'w1', url: EXTERNAL })
      expect(emitted[1].permission).toBeUndefined()
      // One decision, in the one audit trail.
      expect(center.history()).toEqual([expect.objectContaining({ id: record.id, outcome: 'allow', by: 'user' })])
    } finally { settleAll(); await call.catch(() => undefined) }
  })

  it('CA-2 · Deny on that record loads nothing and the agent is told', async () => {
    const { ctx, center, emitted, settleAll } = agentContext()
    const call = handlers.openWebPreview({ url: EXTERNAL }, ctx) as Promise<Result>
    try {
      await vi.waitFor(() => expect(center.list()).toHaveLength(1))
      const record = center.list()[0]
      await vi.waitFor(() => expect(emitted).toEqual([expect.objectContaining({ url: EXTERNAL, permission: 'ask', approvalId: record.id })]))
      center.respond({ id: record.id, generation: record.generation, optionId: record.defaultOptionId })
      const result = await call
      expect(result.isError).toBe(true)
      expect(textOf(result)).toMatch(/declined|denied/i)
      expect(emitted).toHaveLength(1)
      expect(center.history()).toEqual([expect.objectContaining({ id: record.id, outcome: 'deny', by: 'user' })])
    } finally { settleAll(); await call.catch(() => undefined) }
  })

  it('CA-2 · a host the workspace blocked in What agents can do is refused without a request', async () => {
    const permissions = hostPermissions()
    expect(permissions.setHostAccess({ workspaceId: 'w1', host: 'example.com', access: 'blocked' })).toMatchObject({ ok: true })
    const { ctx, center, emitted, settleAll } = agentContext(200)
    try {
      const result = await handlers.openWebPreview({ url: EXTERNAL }, ctx) as Result
      expect(result.isError).toBe(true)
      expect(textOf(result)).toMatch(/What agents can do/)
      expect(center.list()).toEqual([])
      expect(center.history()).toEqual([])
      expect(emitted).toEqual([])
    } finally { settleAll() }
  })

  it('CA-3 · when the agent asks for the Android device and the panel is not open, the app opens it', async () => {
    const devices = new AndroidDevices({ run: async () => ({ status: 0, stdout: '', stderr: '' }), runEmulator: async () => ({ status: 0, stdout: '', stderr: '' }) })
    const access = new AndroidAgentAccess({ devices })
    const openAndroidPanel = vi.fn()
    const execution = { id: 'execution-1', workspaceId: 'w1', paneId: 'p1', owner: { kind: 'pane' as const, id: 'p1' }, cwd: process.cwd() }
    const ctx = { workspaceId: 'w1', executionId: execution.id, executionToken: 'token', executions: { authenticate: () => execution },
      androidAccess: () => access, askAndroidScreenshot: async () => true, openAndroidPanel }
    const result = await handlers.deviceScreenshot({ serial: 'emulator-5554' }, ctx as never) as Result
    expect(openAndroidPanel).toHaveBeenCalledWith({ workspaceId: 'w1', serial: 'emulator-5554' })
    expect(textOf(result)).toMatch(/Android device panel/i)
    expect(textOf(result)).toMatch(/open/i)
  })
})

describe('OXE-109 window · the app opens the panel the agent asked for', () => {
  beforeEach(async () => { resetWindow(); await changeLanguage('en') })
  afterEach(() => { cleanup(); resetWindow() })

  it('CA-1 · from OxeChat or another workspace, the app brings OxeCode and that workspace to the front with the Browser on the page', async () => {
    const { openAgentPreview } = await facade()
    const showCode = vi.fn()
    const activateWorkspace = vi.fn()
    openAgentPreview({ workspaceId: 'w1', url: 'http://127.0.0.1:5180/', requestedAt: 1 }, { view: 'thread', activeWorkspaceId: 'w2', showCode, activateWorkspace })
    expect(showCode).toHaveBeenCalledTimes(1)
    expect(activateWorkspace).toHaveBeenCalledWith('w1')
    const ui = useUIStore.getState() as unknown as { webPreviewOpenByWorkspace: Record<string, boolean>; pendingWebPreviewByWorkspace: Record<string, string> }
    expect(ui.webPreviewOpenByWorkspace.w1).toBe(true)
    expect(ui.pendingWebPreviewByWorkspace.w1).toBe('http://127.0.0.1:5180/')
    // Already in OxeCode on that workspace: nothing is switched.
    showCode.mockClear(); activateWorkspace.mockClear()
    openAgentPreview({ workspaceId: 'w1', url: 'http://127.0.0.1:5180/x', requestedAt: 2 }, { view: 'code', activeWorkspaceId: 'w1', showCode, activateWorkspace })
    expect(showCode).not.toHaveBeenCalled()
    expect(activateWorkspace).not.toHaveBeenCalled()
    // rigor: source-assertion — App.tsx mounts the whole application; this is the wiring of the listener, whose behaviour is proven above.
    expect(readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8')).toMatch(/onWebPreview\([^]*?openAgentPreview\(/)
  })

  it('CA-2 · the panel shows inline the same approval record the approvals center lists, and Allow there answers it', async () => {
    const { openAgentPreview, previewApprovalFor } = await facade()
    const { PreviewApprovalInline } = await inline()
    const api = installApprovalsMock()
    const id = raisePreviewApproval(api.hook)
    openAgentPreview({ workspaceId: 'w1', url: EXTERNAL, requestedAt: 3, permission: 'ask', approvalId: id }, { view: 'code', activeWorkspaceId: 'w1', showCode: vi.fn(), activateWorkspace: vi.fn() })
    const ui = useUIStore.getState() as unknown as { webPreviewOpenByWorkspace: Record<string, boolean>; pendingWebPreviewByWorkspace: Record<string, string> }
    expect(ui.webPreviewOpenByWorkspace.w1).toBe(true)
    // Nothing is handed to the panel to load until the person says OK.
    expect(ui.pendingWebPreviewByWorkspace.w1).toBeUndefined()
    await act(async () => { await useApprovalsStore.getState().sync(api) })
    // The queue the approvals center lists holds it; the panel picks the same record.
    expect(useApprovalsStore.getState().queue.map(request => request.id)).toContain(id)
    expect(previewApprovalFor({ paneIds: ['p1'] }, useApprovalsStore.getState().queue)?.id).toBe(id)
    expect(previewApprovalFor({ paneIds: ['p9'] }, useApprovalsStore.getState().queue)).toBeNull()
    render(createElement(PreviewApprovalInline as never, { owner: { paneIds: ['p1'] } }))
    expect(screen.getByText(EXTERNAL, { exact: false })).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /allow once/i })) })
    await vi.waitFor(() => expect(api.hook.responses).toContainEqual(expect.objectContaining({ id, optionId: 'allow-once' })))
    // rigor: source-assertion — WebPreviewPanel needs the whole preview runtime; the inline record's behaviour is proven above.
    expect(readFileSync(join(process.cwd(), 'src/components/WebPreview/WebPreviewPanel.tsx'), 'utf8')).toMatch(/<PreviewApprovalInline\b/)
  })

  it('CA-2 · Deny in the panel answers the same record, and the request leaves the panel', async () => {
    const { PreviewApprovalInline } = await inline()
    const api = installApprovalsMock()
    const id = raisePreviewApproval(api.hook)
    await act(async () => { await useApprovalsStore.getState().sync(api) })
    render(createElement(PreviewApprovalInline as never, { owner: { paneIds: ['p1'] } }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^deny$/i })) })
    await vi.waitFor(() => expect(api.hook.responses).toContainEqual(expect.objectContaining({ id, optionId: 'deny' })))
    expect(api.hook.responses.filter(response => response.id === 'other-1')).toEqual([])
    await act(async () => { await useApprovalsStore.getState().sync(api) })
    expect(screen.queryByText(EXTERNAL, { exact: false })).toBeNull()
  })

  it('CA-3 · the window opens the Android device panel on main\'s request and keeps it open', () => {
    expect((IPC_CHANNELS.android as Record<string, string>).openPanel).toBe('android:open-panel')
    const ui = useUIStore.getState() as unknown as { openAndroidPanel?: () => void }
    expect(typeof ui.openAndroidPanel).toBe('function')
    ui.openAndroidPanel!()
    ui.openAndroidPanel!()
    expect(useUIStore.getState().isAndroidPanelOpen).toBe(true)
    // rigor: source-assertion — App.tsx and the preload mount the whole application; this is the wiring, the behaviour is proven above.
    expect(readFileSync(join(process.cwd(), 'electron/preload/api.ts'), 'utf8')).toMatch(/IPC_CHANNELS\.android\.openPanel/)
    expect(readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8')).toMatch(/onOpenPanel\([^]*?openAndroidPanel/)
  })
})
