// Frozen acceptance test for 1.5.2 OxeCode F3 (OXE program oxespace-152-code, phase F3, Jira OXE-109).
// Written by the planner; the executor must not edit it.
// Defect (real use, 13/11): when the agent asks for the Web Preview or the Android device, the app only queues the
// request and the person has to find and open the panel: an external URL waits in the approvals center
// (open_web_preview runs gated, "confirm" with previewApproval, electron/main/mcp-internal/tool-handlers.ts:304-305) and
// the panel then shows "turn on External preview"; App.tsx (~line 376) opens the Browser of the event's workspace but
// neither brings OxeCode to the front nor selects that workspace; device_screenshot with "Agents can see" off only
// tells the agent to ask the person.
// Contract:
// - open_web_preview, a local page (localhost / 127.0.0.1): emits the preview event at once, no approval asked (as today).
// - open_web_preview, an external page: never waits on the approvals broker; it emits the event at once with
//   `permission: 'ask'` (InternalMcpWebPreviewEvent, shared/types/mcp-internal.ts, gains `permission?: 'ask'`) and
//   tells the agent the person is asked in the Web Preview. RT-1: the confirmation stays, it moves into the panel.
// - src/app/agentPreview.ts exports `openAgentPreview(event, app)` with
//   app = { view: AppView; activeWorkspaceId: string | null; showCode(): void; activateWorkspace(id: string): void }.
//   App.tsx's onWebPreview listener calls it. For a Code (workspace) event it opens that workspace's Browser, brings
//   OxeCode to the front when another view shows, and selects the workspace when another one is active. A local page
//   is handed to the panel to load (ui.pendingWebPreviewByWorkspace); an external page with permission 'ask' is NOT: it
//   goes to ui.previewPermissionByWorkspace[workspaceId] (new, with setPreviewPermission(key, url | null)), which the
//   panel shows as a one-click "Allow" prompt; nothing loads before that OK.
// - Android: ToolContext gains `openAndroidPanel?(request: { workspaceId: string; serial: string }): void`, passed by
//   bootstrap/local RPC and wired in index.ts to broadcast IPC_CHANNELS.android.openPanel ('android:open-panel').
//   device_screenshot with "Agents can see" off calls it and tells the agent the panel was opened for the person.
//   ui.store gains openAndroidPanel(), which opens the panel and keeps it open (a toggle would close it).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/user-data', getAppPath: () => '/app', isPackaged: false, getVersion: () => '1.5.2' }, BrowserWindow: { getAllWindows: () => [] } }))

await import('../../../electron/main/mcp-internal/tool-registry')
const { handlers } = await import('../../../electron/main/mcp-internal/tool-handlers')
const { AgentActions } = await import('../../../electron/main/services/agent-actions/agent-actions')
const { ExecutionRegistry } = await import('../../../electron/main/services/execution-registry')
const { AndroidAgentAccess, AndroidDevices } = await import('../../../electron/main/services/android/android-devices')
const { IPC_CHANNELS } = await import('../../../shared/types/ipc')
const { useUIStore } = await import('../../../src/store/ui.store')

type Result = { content: Array<{ type: string; text?: string }>; isError?: boolean }
const textOf = (result: Result): string => result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')

function agentContext() {
  const executions = new ExecutionRegistry()
  const env = executions.register({ owner: { kind: 'pane', id: 'p1' }, workspaceId: 'w1', cwd: process.cwd() })
  const require = vi.fn(async () => ({ state: 'pending' as const }))
  const emitted: Array<Record<string, unknown>> = []
  const ctx = {
    workspaceId: 'w1', executionId: env.OXESPACE_EXECUTION_ID, executionToken: env.OXESPACE_EXECUTION_TOKEN, executions,
    workspaceServ: { get: (id: string) => id === 'w1' ? { id: 'w1', name: 'site', rootPath: process.cwd(), panes: [{ id: 'p1', type: 'terminal' }] } : undefined, list: () => [] },
    agentActions: new AgentActions({ broker: { require } as never }),
    webPreview: { emitPreview: (event: Record<string, unknown>) => { emitted.push(event) } }
  }
  return { ctx: ctx as never, require, emitted }
}

async function agentPreview() {
  // Resolved at run time: the module is the contract this card creates.
  const path = '../../../src/app/agentPreview'
  return (await import(/* @vite-ignore */ path)) as { openAgentPreview(event: Record<string, unknown>, app: Record<string, unknown>): void }
}

const resetWindow = (): void => {
  useUIStore.setState({ pendingWebPreviewByWorkspace: {}, webPreviewOpenByWorkspace: {}, isAndroidPanelOpen: false } as never)
  useUIStore.setState({ previewPermissionByWorkspace: {} } as never)
}

describe('OXE-109 main · what the agent asks for reaches the panels at once', () => {
  it('CA-1 · a localhost page of the workspace opens at once, with no confirmation', async () => {
    const { ctx, require, emitted } = agentContext()
    const result = await handlers.openWebPreview({ url: 'http://127.0.0.1:5180/' }, ctx) as Result
    expect(result.isError).toBeFalsy()
    expect(require).not.toHaveBeenCalled()
    expect(emitted).toEqual([expect.objectContaining({ workspaceId: 'w1', url: 'http://127.0.0.1:5180/' })])
    expect(emitted[0].permission).toBeUndefined()
  })

  it('CA-2 · an external URL is asked in the Web Preview, not in the approvals center', async () => {
    const { ctx, require, emitted } = agentContext()
    const result = await handlers.openWebPreview({ url: 'https://example.com/docs' }, ctx) as Result
    // The confirmation stays (RT-1), in the panel: the approvals broker is not where the agent waits.
    expect(require).not.toHaveBeenCalled()
    expect(emitted).toEqual([expect.objectContaining({ workspaceId: 'w1', url: 'https://example.com/docs', permission: 'ask' })])
    const text = textOf(result)
    expect(text).toMatch(/Web Preview/)
    expect(text).toMatch(/allow|approve|OK/i)
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
  beforeEach(resetWindow)

  it('CA-1 · from OxeChat or another workspace, the app brings OxeCode and that workspace to the front with the Browser on the page', async () => {
    const { openAgentPreview } = await agentPreview()
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
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8')
    expect(app).toMatch(/onWebPreview\([^]*?openAgentPreview\(/)
  })

  it('CA-2 · the panel opens with the one-click permission request, and nothing loads before the OK', async () => {
    const { openAgentPreview } = await agentPreview()
    openAgentPreview({ workspaceId: 'w1', url: 'https://example.com/docs', requestedAt: 3, permission: 'ask' }, { view: 'code', activeWorkspaceId: 'w1', showCode: vi.fn(), activateWorkspace: vi.fn() })
    const ui = useUIStore.getState() as unknown as { webPreviewOpenByWorkspace: Record<string, boolean>; pendingWebPreviewByWorkspace: Record<string, string>; previewPermissionByWorkspace: Record<string, string> }
    expect(ui.webPreviewOpenByWorkspace.w1).toBe(true)
    expect(ui.previewPermissionByWorkspace.w1).toBe('https://example.com/docs')
    // Nothing is handed to the panel to load until the person says OK.
    expect(ui.pendingWebPreviewByWorkspace.w1).toBeUndefined()
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
