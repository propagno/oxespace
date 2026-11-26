import { act, cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentProfile } from '../../shared/types/agent'
import type { WorkspacePane } from '../../shared/types/workspace'
import { inferAgentProfile, TerminalPane } from '../../src/components/Panes/TerminalPane'
import { useAgentStore } from '../../src/store/agent.store'
import { useTerminalStore } from '../../src/store/terminal.store'
import { useWorkspaceStore } from '../../src/store/workspace.store'
import { derivePaneDisplayState, resolvePaneIdentity } from '../../src/utils/paneDisplay'

let capturedOnInput: ((data: string) => void) | null = null

vi.mock('../../src/components/Terminal/TerminalView', () => ({
  TerminalView: ({ onInput }: { onInput: (data: string) => void }) => {
    capturedOnInput = onInput
    return createElement('div', { 'data-testid': 'terminal-view' })
  }
}))

const PROFILES: AgentProfile[] = [
  {
    agentProfileId: 'builtin-agent-claude',
    name: 'Claude',
    provider: 'claude',
    command: 'claude',
    commandTemplate: 'claude {{task}}',
    isBuiltin: true
  },
  {
    agentProfileId: 'builtin-agent-codex',
    name: 'Codex',
    provider: 'codex',
    command: 'codex',
    commandTemplate: 'codex {{task}}',
    isBuiltin: true
  },
  {
    agentProfileId: 'builtin-agent-antigravity',
    name: 'Antigravity',
    provider: 'antigravity',
    command: 'agy',
    commandTemplate: 'agy {{task}}',
    isBuiltin: true
  },
  {
    agentProfileId: 'custom-claude-review',
    name: 'Claude Reviewer',
    provider: 'custom',
    parentProvider: 'claude',
    command: '',
    commandTemplate: '{{task}}',
    isBuiltin: false
  }
]

function makePane(overrides: Partial<WorkspacePane> = {}): WorkspacePane {
  return {
    id: 'pane-1',
    workspaceId: 'workspace-1',
    type: 'terminal',
    rowIndex: 0,
    columnIndex: 0,
    shellProfileId: 'builtin-powershell',
    status: 'idle',
    agentProfileId: null,
    agentName: null,
    displayName: null,
    createdAt: null,
    rootPath: null,
    ...overrides
  }
}

describe('OXE-294 · TerminalPane agent identity', () => {
  beforeEach(() => {
    capturedOnInput = null
    useTerminalStore.setState({ panes: {}, pendingCommands: {}, activePaneId: null })
    useAgentStore.setState({
      profiles: PROFILES,
      allProfiles: PROFILES,
      readiness: [],
      isLoading: false,
      isDiscovering: false,
      lastHealthCheckAt: null,
      error: null
    })
    useWorkspaceStore.setState({
      workspaces: [{
        id: 'workspace-1',
        name: 'oxespace',
        rootPath: 'C:/repo/oxespace',
        layout: '1x1',
        layoutPreset: 1,
        themeId: 'midnight',
        uiDensity: 'compact',
        defaultShellProfileId: 'builtin-powershell',
        autoStart: false,
        isActive: true,
        panes: []
      }],
      shellProfiles: [
        { id: 'builtin-claude', name: 'Claude', executable: 'claude', args: [], isBuiltin: true },
        { id: 'builtin-powershell', name: 'PowerShell', executable: 'powershell.exe', args: [], isBuiltin: true }
      ],
      activeWorkspaceId: 'workspace-1',
      isLoading: false,
      error: null
    })
    window.oxe = {
      app: { version: '1.5.3', platform: 'win32' },
      workspace: {
        setPaneAgent: vi.fn().mockResolvedValue({ id: 'workspace-1', panes: [] })
      },
      terminal: {
        start: vi.fn().mockResolvedValue(undefined),
        write: vi.fn().mockResolvedValue(undefined),
        resize: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        status: vi.fn().mockResolvedValue({ running: true, seq: 1, altScreen: false })
      }
    } as unknown as typeof window.oxe
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('does not overwrite bound Claude pane agent identity when input or terminal title mentions Antigravity', () => {
    const scenarios: Array<{ label: string; pane: WorkspacePane; runtimeAgent?: string }> = [
      {
        label: 'bound agentProfileId',
        pane: makePane({ agentProfileId: 'builtin-agent-claude', shellProfileId: 'builtin-powershell' })
      },
      {
        label: 'runtime AgentStateService agentName',
        pane: makePane({ agentProfileId: null, shellProfileId: 'builtin-powershell' }),
        runtimeAgent: 'claude'
      },
      {
        label: 'agent-launcher shellProfileId',
        pane: makePane({ agentProfileId: null, shellProfileId: 'builtin-claude' })
      }
    ]

    for (const scenario of scenarios) {
      vi.mocked(window.oxe.workspace.setPaneAgent).mockClear()
      useTerminalStore.setState({
        panes: {
          'pane-1': {
            status: 'running',
            lastActivityAt: Date.now(),
            lastOutput: 'Antigravity handoff ready',
            isWorking: false,
            hasUnread: false,
            error: null,
            agentName: scenario.runtimeAgent
          }
        },
        pendingCommands: {},
        activePaneId: 'pane-1'
      })

      render(
        createElement(TerminalPane, {
          pane: scenario.pane,
          workspaceId: 'workspace-1',
          workspaceRootPath: 'C:/repo/oxespace',
          autoStart: false
        })
      )
      expect(capturedOnInput, scenario.label).not.toBeNull()

      act(() => {
        capturedOnInput!('Antigravity handoff status\r')
        capturedOnInput!('agy --help\r')
        capturedOnInput!('codex check\r')
      })

      expect(window.oxe.workspace.setPaneAgent, scenario.label).not.toHaveBeenCalled()
      expect(useTerminalStore.getState().getStatus('pane-1').lastIntent, scenario.label).toBe('codex check')

      const profile = PROFILES.find((p) => p.agentProfileId === scenario.pane.agentProfileId) ?? null
      const identity = resolvePaneIdentity({ pane: scenario.pane, profile, agent: scenario.runtimeAgent })
      expect(identity.key, scenario.label).toBe('claude')
      expect(identity.label, scenario.label).toBe('Claude')
      cleanup()
    }
  })

  it('inferAgentProfile matches executable invocations on unbound shells and ignores natural-language provider names', () => {
    expect(inferAgentProfile('Antigravity handoff', PROFILES)).toBeNull()
    expect(inferAgentProfile('antigravity status check', PROFILES)).toBeNull()
    expect(inferAgentProfile('custom prompt', PROFILES)).toBeNull()
    expect(inferAgentProfile('', PROFILES)).toBeNull()

    expect(inferAgentProfile('claude', PROFILES)?.agentProfileId).toBe('builtin-agent-claude')
    expect(inferAgentProfile('codex --model o3', PROFILES)?.agentProfileId).toBe('builtin-agent-codex')
    expect(inferAgentProfile('agy', PROFILES)?.agentProfileId).toBe('builtin-agent-antigravity')
    expect(inferAgentProfile('C:\\tools\\claude.exe --resume', PROFILES)?.agentProfileId).toBe('builtin-agent-claude')
  })

  it('keeps Claude providerKey and providerLabel in paneDisplay when title mentions Antigravity', () => {
    const claudeProfile = PROFILES[0]
    const pane = makePane({
      agentProfileId: claudeProfile.agentProfileId,
      shellProfileId: 'builtin-claude',
      displayName: 'Antigravity handoff'
    })
    const display = derivePaneDisplayState({
      pane,
      workspace: { name: 'oxespace', rootPath: 'C:/repo/oxespace' },
      terminal: {
        status: 'running',
        isWorking: false,
        hasUnread: false,
        lastIntent: 'Antigravity handoff',
        lastOutput: 'Waiting for Antigravity handoff',
        agentName: 'claude'
      },
      profile: claudeProfile,
      paneIndex: 0
    })

    expect(display.providerKey).toBe('claude')
    expect(display.providerLabel).toBe('Claude')
    expect(display.title).toBe('Antigravity handoff')

    // Even without explicit displayName, free lastIntent mentioning Antigravity stays as title without changing provider.
    const fromIntent = derivePaneDisplayState({
      pane: makePane({ agentProfileId: claudeProfile.agentProfileId, shellProfileId: 'builtin-claude', displayName: null }),
      workspace: { name: 'oxespace', rootPath: 'C:/repo/oxespace' },
      terminal: {
        status: 'running',
        isWorking: false,
        hasUnread: false,
        lastIntent: 'Antigravity handoff',
        lastOutput: null,
        agentName: 'claude'
      },
      profile: claudeProfile,
      paneIndex: 0
    })

    expect(fromIntent.providerKey).toBe('claude')
    expect(fromIntent.providerLabel).toBe('Claude')
    expect(fromIntent.title).toBe('Antigravity handoff')
  })

  it('sanitizes pasted oxe-paste-* image paths from TerminalPane input and preserves prior intent on paste-only Enter (OXE-440)', () => {
    const pane = makePane({ agentProfileId: 'builtin-agent-claude', shellProfileId: 'builtin-powershell' })
    useTerminalStore.setState({
      panes: {
        'pane-1': {
          status: 'running',
          lastActivityAt: Date.now(),
          lastOutput: null,
          lastIntent: null,
          lastIntentAt: null,
          isWorking: false,
          hasUnread: false,
          error: null,
          hookState: null,
          hookAt: null,
          agentState: null,
          agentSource: null,
          agentName: 'claude',
          location: null,
          shellCommand: null,
          detached: false
        }
      },
      pendingCommands: {},
      activePaneId: 'pane-1'
    })

    render(
      createElement(TerminalPane, {
        pane,
        workspaceId: 'workspace-1',
        workspaceRootPath: 'C:/repo/oxespace',
        autoStart: false
      })
    )
    expect(capturedOnInput).not.toBeNull()

    act(() => {
      capturedOnInput!('\x1b[200~C:\\Users\\dudu-\\AppData\\Local\\Temp\\oxe-paste-2dd648b2-7d4b-41d7-a7ad-9fa28dec330a.png \x1b[201~/usage\r')
    })
    expect(useTerminalStore.getState().getStatus('pane-1').lastIntent).toBe('/usage')

    // Pasting ONLY an image and hitting Enter must not clobber the existing lastIntent.
    act(() => {
      capturedOnInput!('\x1b[200~C:\\Users\\dudu-\\AppData\\Local\\Temp\\oxe-paste-99999999-aaaa-bbbb-cccc-dddddddddddd.png \x1b[201~\r')
    })
    expect(useTerminalStore.getState().getStatus('pane-1').lastIntent).toBe('/usage')
  })
})

// Frozen acceptance test for 1.5.2 Multiprovedor (Jira OXE-318, A1–A2). Written by the planner; the executor must not
// edit it. A pane bound to a custom sub-profile (parentProvider 'claude', its own systemPrompt) keeps that profile on
// start and restart: the inference that binds a free shell to a built-in agent runs only when the pane has no profile.
const SUB_PROFILES: AgentProfile[] = [
  { agentProfileId: 'builtin-agent-claude', name: 'Claude', provider: 'claude', command: 'claude', commandTemplate: 'claude {{task}}', isBuiltin: true },
  { agentProfileId: 'custom-claude-reviewer', name: 'Claude Reviewer', provider: 'custom', parentProvider: 'claude', command: '', commandTemplate: '{{task}}', systemPrompt: 'Review only; never edit.', isBuiltin: false }
]

describe('OXE-318 · TerminalPane keeps a custom sub-profile', () => {
  beforeEach(() => {
    useTerminalStore.setState({ panes: {}, pendingCommands: {}, activePaneId: null })
    useAgentStore.setState({ profiles: SUB_PROFILES, allProfiles: SUB_PROFILES, readiness: [], isLoading: false, isDiscovering: false, lastHealthCheckAt: null, error: null })
    window.oxe = {
      app: { version: '1.5.2', platform: 'win32' },
      workspace: { setPaneAgent: vi.fn().mockResolvedValue({ id: 'workspace-1', panes: [] }) },
      terminal: {
        start: vi.fn().mockResolvedValue(undefined),
        write: vi.fn().mockResolvedValue(undefined),
        resize: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        status: vi.fn().mockResolvedValue({ running: false, seq: 0, altScreen: false })
      }
    } as unknown as typeof window.oxe
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('start and restart preserve custom sub-profile agentProfileId and systemPrompt', async () => {
    const pane = makePane({ agentProfileId: 'custom-claude-reviewer' })
    render(createElement(TerminalPane, { pane, workspaceId: 'workspace-1', workspaceRootPath: 'C:/repo/oxespace', autoStart: true }))
    await vi.waitFor(() => expect(window.oxe.terminal.start).toHaveBeenCalledTimes(1))
    expect(vi.mocked(window.oxe.terminal.start).mock.calls[0][0]).toMatchObject({ paneId: 'pane-1', agentCommand: 'claude', initialPrompt: 'Review only; never edit.' })

    // Restart: the header's "new session" on a running pane.
    act(() => { useTerminalStore.getState().setStatus('pane-1', 'running') })
    act(() => { window.dispatchEvent(new CustomEvent('oxe:terminal-new-session', { detail: { paneId: 'pane-1' } })) })
    await vi.waitFor(() => expect(window.oxe.terminal.start).toHaveBeenCalledTimes(2))
    expect(vi.mocked(window.oxe.terminal.start).mock.calls[1][0]).toMatchObject({ paneId: 'pane-1', agentCommand: 'claude', initialPrompt: 'Review only; never edit.' })

    const rebinds = vi.mocked(window.oxe.workspace.setPaneAgent).mock.calls.filter(call => (call[0] as { agentProfileId?: string }).agentProfileId === 'builtin-agent-claude')
    expect(rebinds).toHaveLength(0)
  })

  it('start infers builtin agent profile when pane has no agentProfileId', async () => {
    useTerminalStore.setState({ panes: {}, pendingCommands: { 'pane-1': 'claude' }, activePaneId: null })
    const pane = makePane({ agentProfileId: null })
    render(createElement(TerminalPane, { pane, workspaceId: 'workspace-1', workspaceRootPath: 'C:/repo/oxespace', autoStart: true }))
    await vi.waitFor(() => expect(window.oxe.terminal.start).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(window.oxe.workspace.setPaneAgent).toHaveBeenCalled())
    expect(vi.mocked(window.oxe.workspace.setPaneAgent).mock.calls[0][0]).toMatchObject({ paneId: 'pane-1', agentProfileId: 'builtin-agent-claude' })
  })
})
