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

  test('prioritizes pane display name, then user intent, then clean output', () => {
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
      terminal: { ...terminal, lastIntent: 'please fix auth race', lastOutput: 'raw output' },
      profile: null,
      paneIndex: 0
    }).title).toBe('please fix auth race')

    expect(derivePaneDisplayState({
      pane,
      workspace,
      terminal: { ...terminal, lastOutput: 'Tests passed' },
      profile: null,
      paneIndex: 0
    }).title).toBe('Tests passed')
  })

  test('compacts paths and never exposes full windows paths in visible labels', () => {
    expect(compactPathLabel('C:\\Users\\dudu-\\Estudos\\oxespace')).toBe('oxespace')
    expect(compactPathLabel('C:\\Users\\dudu-\\Estudos\\very-very-long-workspace-name')).toBe('very-very-long-worksp...')
  })
})
