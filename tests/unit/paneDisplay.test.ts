import { describe, expect, test } from 'vitest'
import type { Workspace, WorkspacePane } from '../../shared/types/workspace'
import { compactPathLabel, derivePaneDisplayState, sanitizeTerminalPreview } from '../../src/utils/paneDisplay'

const workspace: Pick<Workspace, 'name' | 'rootPath'> = {
  name: 'oxespace',
  rootPath: 'C:\\Users\\dudu-\\Estudos\\oxespace'
}

const pane: WorkspacePane = {
  id: 'pane-1',
  workspaceId: 'workspace-1',
  type: 'terminal',
  rowIndex: 0,
  columnIndex: 0,
  shellProfileId: 'powershell',
  status: 'running',
  agentProfileId: null,
  agentName: null,
  displayName: null,
  createdAt: null,
  rootPath: null
}

const terminal = {
  status: 'running' as const,
  error: null,
  lastActivityAt: Date.now(),
  lastOutput: null,
  lastIntent: null,
  lastIntentAt: null,
  isWorking: false,
  hasUnread: false
}

describe('pane display model', () => {
  test('sanitizes terminal noise and rejects useless previews', () => {
    expect(sanitizeTerminalPreview('\u001b]4;0;rgb:3b3b/4242/6060\u0007')).toBeNull()
    expect(sanitizeTerminalPreview('Copilot v1.0.49 uses AI.\nCheck for mistakes.')).toBeNull()
    expect(sanitizeTerminalPreview('C:\\Users\\dudu-\\Estudos\\repo')).toBeNull()
    expect(sanitizeTerminalPreview('\u001b[32mBuild completed successfully\u001b[39m')).toBe('Build completed successfully')
  })

  test('an agent pane is named by display name, then user intent, then clean output', () => {
    // An agent runs in this pane: its lifecycle reports a state.
    const agent = { ...terminal, agentState: 'idle' as const }
    expect(derivePaneDisplayState({
      pane: { ...pane, displayName: 'Auth fix' },
      workspace,
      terminal: { ...terminal, lastIntent: 'please fix auth race', lastOutput: 'raw output' },
      profile: null,
      paneIndex: 0
    }).title).toBe('Auth fix')

    expect(derivePaneDisplayState({
      pane,
      workspace,
      terminal: { ...agent, lastIntent: 'please fix auth race', lastOutput: 'raw output' },
      profile: null,
      paneIndex: 0
    }).title).toBe('please fix auth race')

    expect(derivePaneDisplayState({
      pane,
      workspace,
      terminal: { ...agent, lastOutput: 'Tests passed' },
      profile: null,
      paneIndex: 0
    }).title).toBe('Tests passed')
  })

  test('a plain shell keeps its name: the last command is a hint, and it is idle after the command ends', () => {
    const shell = derivePaneDisplayState({
      pane,
      workspace,
      terminal: { ...terminal, lastIntent: 'npm test', lastIntentAt: Date.now(), lastActivityAt: Date.now(), lastOutput: '2 tests passed' },
      profile: null,
      paneIndex: 0
    })
    expect(shell.title).toBe('Terminal 1')
    expect(shell.lastCommand).toBe('npm test')
    expect(shell.statusTone).toBe('idle')
    expect(shell.originLabel).toBeNull()
    // While output streams, a shell is running, not thinking.
    expect(derivePaneDisplayState({ pane, workspace, terminal: { ...terminal, isWorking: true }, profile: null, paneIndex: 0 }).statusLabel).toBe('Running')
  })

  test('compacts paths and never exposes full windows paths in visible labels', () => {
    expect(compactPathLabel('C:\\Users\\dudu-\\Estudos\\oxespace')).toBe('oxespace')
    expect(compactPathLabel('C:\\Users\\dudu-\\Estudos\\very-very-long-workspace-name')).toBe('very-very-long-worksp...')
  })

  test('provider chip prefers bound agent over shell profile', () => {
    const withAgent = derivePaneDisplayState({
      pane: { ...pane, shellProfileId: 'builtin-claude', agentProfileId: 'agent-codex', agentName: 'Codex' },
      workspace,
      terminal,
      profile: {
        agentProfileId: 'agent-codex',
        name: 'Codex',
        provider: 'codex',
        command: 'codex',
        commandTemplate: 'codex',
        isBuiltin: true
      },
      paneIndex: 0,
      shellProfileName: 'Claude'
    })
    expect(withAgent.providerLabel).toBe('Codex')
    expect(withAgent.providerKey).toBe('codex')

    const shellOnly = derivePaneDisplayState({
      pane: { ...pane, shellProfileId: 'builtin-powershell', agentProfileId: null, agentName: null },
      workspace,
      terminal,
      profile: null,
      paneIndex: 0,
      shellProfileName: 'PowerShell'
    })
    expect(shellOnly.providerLabel).toBe('PowerShell')
    expect(shellOnly.providerKey).toBe('shell')
  })
})
