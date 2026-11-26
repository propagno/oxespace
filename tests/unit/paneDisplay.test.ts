import { cleanup, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Workspace, WorkspacePane } from '../../shared/types/workspace'
import { PaneSessionRow } from '../../src/components/Sidebar/PaneSessionRow'
import { useTerminalStore } from '../../src/store/terminal.store'
import { compactPathLabel, derivePaneDisplayState, sanitizeTerminalIntent, sanitizeTerminalPreview } from '../../src/utils/paneDisplay'

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
    expect(derivePaneDisplayState({ pane, workspace, terminal: { ...terminal, isWorking: true }, profile: null, paneIndex: 0 }).statusLabel).toBe('Working')
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

describe('OXE-440 · temp oxe-paste-* path sanitization', () => {
  afterEach(() => {
    cleanup()
    useTerminalStore.setState({ panes: {}, pendingCommands: {}, activePaneId: null })
  })

  test('strips Windows unquoted, quoted, and spaced temp paste paths from previews and intents', () => {
    const winUnquoted = 'C:\\Users\\dudu-\\AppData\\Local\\Temp\\oxe-paste-2dd648b2-7d4b-41d7-a7ad-9fa28dec330a.png /usage'
    expect(sanitizeTerminalPreview(winUnquoted)).toBe('/usage')
    expect(sanitizeTerminalIntent(winUnquoted)).toBe('/usage')

    const winDoubleQuoted = '"C:\\Users\\dudu-\\AppData\\Local\\Temp\\oxe-paste-2dd648b2.png" analise este erro'
    expect(sanitizeTerminalPreview(winDoubleQuoted)).toBe('analise este erro')
    expect(sanitizeTerminalIntent(winDoubleQuoted)).toBe('analise este erro')

    const winSingleQuoted = "'C:\\Users\\John Doe\\AppData\\Local\\Temp\\oxe-paste-2dd648b2.jpeg' confira o log"
    expect(sanitizeTerminalPreview(winSingleQuoted)).toBe('confira o log')
    expect(sanitizeTerminalIntent(winSingleQuoted)).toBe('confira o log')

    const winUnquotedSpaces = 'C:\\Users\\John Doe\\AppData\\Local\\Temp\\oxe-paste-2dd648b2.PNG /usage'
    expect(sanitizeTerminalPreview(winUnquotedSpaces)).toBe('/usage')
    expect(sanitizeTerminalIntent(winUnquotedSpaces)).toBe('/usage')
  })

  test('strips POSIX /tmp and /var/folders temp paste paths across common image extensions', () => {
    expect(sanitizeTerminalPreview('/tmp/oxe-paste-abcd1234.png explain')).toBe('explain')
    expect(sanitizeTerminalPreview('/var/folders/5x/ab12cd/T/oxe-paste-abcd1234.webp fix header')).toBe('fix header')
    expect(sanitizeTerminalIntent('"/tmp/oxe-paste-abcd1234.jpg" check diff')).toBe('check diff')
    expect(sanitizeTerminalIntent('/tmp/sub/oxe-paste-abcd1234.gif inspect animation')).toBe('inspect animation')
  })

  test('strips multiple pasted image paths while preserving surrounding user text', () => {
    const multi = [
      'C:\\Users\\dudu-\\AppData\\Local\\Temp\\oxe-paste-1111.png',
      '"C:\\Users\\dudu-\\AppData\\Local\\Temp\\oxe-paste-2222.jpg"',
      '/tmp/oxe-paste-3333.webp',
      'compare these screenshots'
    ].join(' ')
    expect(sanitizeTerminalPreview(multi)).toBe('compare these screenshots')
    expect(sanitizeTerminalIntent(multi)).toBe('compare these screenshots')
  })

  test('returns null when only temp paste image paths remain', () => {
    expect(sanitizeTerminalPreview('C:\\Users\\dudu-\\AppData\\Local\\Temp\\oxe-paste-2dd648b2.png')).toBeNull()
    expect(sanitizeTerminalPreview('"C:\\Users\\dudu-\\AppData\\Local\\Temp\\oxe-paste-2dd648b2.png"')).toBeNull()
    expect(sanitizeTerminalPreview('/tmp/oxe-paste-abcd1234.png')).toBeNull()
    expect(sanitizeTerminalPreview('/tmp/oxe-paste-1.png /tmp/oxe-paste-2.gif')).toBeNull()
    expect(sanitizeTerminalIntent('C:\\Users\\dudu-\\AppData\\Local\\Temp\\oxe-paste-2dd648b2.png')).toBeNull()
    expect(sanitizeTerminalIntent('"/tmp/oxe-paste-abcd1234.webp"')).toBeNull()
  })

  test('preserves normal file paths and URLs that are not temp oxe-paste-* attachments', () => {
    expect(sanitizeTerminalPreview('Compare C:\\Users\\dudu-\\Pictures\\screenshot.png with mockup'))
      .toBe('Compare C:\\Users\\dudu-\\Pictures\\screenshot.png with mockup')
    expect(sanitizeTerminalIntent('Open https://example.com/tmp/oxe-paste-1234.png'))
      .toBe('Open https://example.com/tmp/oxe-paste-1234.png')
    expect(sanitizeTerminalIntent('Fix oxe-paste- title sanitization'))
      .toBe('Fix oxe-paste- title sanitization')
  })

  test('derivePaneDisplayState hides pasted image paths and falls back when intent is paste-only', () => {
    const agent = { ...terminal, agentState: 'idle' as const }
    expect(derivePaneDisplayState({
      pane,
      workspace,
      terminal: {
        ...agent,
        lastIntent: 'C:\\Users\\dudu-\\AppData\\Local\\Temp\\oxe-paste-2dd648b2-7d4b-41d7-a7ad-9fa28dec330a.png /usage'
      },
      profile: null,
      paneIndex: 0
    }).title).toBe('/usage')

    expect(derivePaneDisplayState({
      pane,
      workspace,
      terminal: {
        ...agent,
        lastIntent: 'C:\\Users\\dudu-\\AppData\\Local\\Temp\\oxe-paste-2dd648b2.png',
        lastOutput: 'Tests passed'
      },
      profile: null,
      paneIndex: 0
    }).title).toBe('Tests passed')
  })

  test('setLastIntent sanitizes pasted paths before truncating and does not clobber prior intent on paste-only Enter', () => {
    const store = useTerminalStore.getState()
    store.setLastIntent('pane-1', 'Investigate auth race')
    expect(useTerminalStore.getState().getStatus('pane-1').lastIntent).toBe('Investigate auth race')

    // Bare pasted image path must NOT overwrite a meaningful prior intent.
    store.setLastIntent('pane-1', 'C:\\Users\\dudu-\\AppData\\Local\\Temp\\oxe-paste-2dd648b2-7d4b-41d7-a7ad-9fa28dec330a.png')
    expect(useTerminalStore.getState().getStatus('pane-1').lastIntent).toBe('Investigate auth race')

    // Temp path is stripped BEFORE the 120-char cap so the user's real prompt stays intact.
    const realPrompt = 'Please inspect the stack trace in this screenshot and fix the pane title truncation logic'
    store.setLastIntent('pane-1', `C:\\Users\\dudu-\\AppData\\Local\\Temp\\oxe-paste-2dd648b2-7d4b-41d7-a7ad-9fa28dec330a.png ${realPrompt}`)
    expect(useTerminalStore.getState().getStatus('pane-1').lastIntent).toBe(realPrompt)
  })

  test('PaneSessionRow hides temp oxe-paste-* paths in sidebar labels and falls back cleanly on paste-only intent', () => {
    const fullWorkspace = { ...workspace, id: 'workspace-1', panes: [pane] } as unknown as Workspace
    useTerminalStore.setState({
      panes: {
        'pane-1': {
          status: 'running',
          error: null,
          lastActivityAt: Date.now(),
          lastOutput: 'Tests passed',
          lastIntent: 'C:\\Users\\dudu-\\AppData\\Local\\Temp\\oxe-paste-2dd648b2-7d4b-41d7-a7ad-9fa28dec330a.png /usage',
          lastIntentAt: Date.now(),
          isWorking: false,
          hasUnread: false,
          hookState: null,
          hookAt: null,
          agentState: 'idle',
          agentSource: 'hook',
          agentName: 'claude',
          location: null,
          shellCommand: null,
          detached: false
        }
      },
      pendingCommands: {},
      activePaneId: null
    })

    render(createElement(PaneSessionRow, {
      pane,
      paneIndex: 0,
      workspace: fullWorkspace,
      isActive: false,
      agentProfiles: [],
      onClick: vi.fn(),
      onActivatePane: vi.fn()
    }))
    expect(screen.getByText('Claude · /usage')).toBeInTheDocument()

    cleanup()
    useTerminalStore.setState({
      panes: {
        'pane-1': {
          ...useTerminalStore.getState().getStatus('pane-1'),
          lastIntent: 'C:\\Users\\dudu-\\AppData\\Local\\Temp\\oxe-paste-2dd648b2-7d4b-41d7-a7ad-9fa28dec330a.png'
        }
      },
      pendingCommands: {},
      activePaneId: null
    })

    render(createElement(PaneSessionRow, {
      pane,
      paneIndex: 0,
      workspace: fullWorkspace,
      isActive: false,
      agentProfiles: [],
      onClick: vi.fn(),
      onActivatePane: vi.fn()
    }))
    expect(screen.getByText('Claude · Tests passed')).toBeInTheDocument()
  })
})
