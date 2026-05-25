import { describe, expect, test } from 'vitest'
import {
  compactPathLabel,
  derivePaneDisplayState,
  formatPaneStatus,
  sanitizeTerminalPreview,
  stripTerminalControl,
  type PaneDisplayTerminalState
} from '../../src/utils/paneDisplay'
import type { AgentProfile } from '../../shared/types/agent'
import type { Workspace, WorkspacePane } from '../../shared/types/workspace'

const DEFAULT_TERMINAL: PaneDisplayTerminalState = {
  status: 'running',
  error: null,
  lastActivityAt: null,
  lastOutput: null,
  lastIntent: null,
  lastIntentAt: null,
  isWorking: false,
  hasUnread: false
}

const BASE_PANE: WorkspacePane = {
  id: 'pane-1',
  workspaceId: 'ws-1',
  type: 'terminal',
  rowIndex: 0,
  columnIndex: 0,
  status: 'running',
  agentProfileId: null,
  agentName: null,
  displayName: null,
  shellProfileId: null,
  rootPath: null,
  createdAt: null
}

const BASE_WORKSPACE: Workspace = {
  id: 'ws-1',
  name: 'demo',
  rootPath: 'C:/Users/dev/projects/demo',
  layout: '2x2',
  layoutPreset: 4,
  themeId: 'midnight',
  uiDensity: 'compact',
  defaultShellProfileId: 'builtin-claude',
  autoStart: true,
  isActive: true,
  editorVisible: false,
  editorExpanded: false,
  editorWidthPercent: 40,
  reviewPanelVisible: false,
  reviewPanelExpanded: false,
  reviewPanelWidthPercent: 36,
  githubPanelVisible: false,
  githubPanelExpanded: false,
  githubPanelWidthPercent: 40,
  githubActiveTab: 'status',
  backgroundPanelVisible: false,
  backgroundPanelExpanded: false,
  backgroundPanelWidthPercent: 36,
  panes: []
}

const CLAUDE_PROFILE: AgentProfile = {
  agentProfileId: 'agent-claude',
  name: 'Claude',
  provider: 'claude',
  command: 'claude',
  commandTemplate: 'claude',
  isBuiltin: true
}

function deriveWith(overrides: Partial<PaneDisplayTerminalState> = {}, paneOverrides: Partial<WorkspacePane> = {}): ReturnType<typeof derivePaneDisplayState> {
  return derivePaneDisplayState({
    pane: { ...BASE_PANE, ...paneOverrides },
    workspace: BASE_WORKSPACE,
    terminal: { ...DEFAULT_TERMINAL, ...overrides },
    profile: CLAUDE_PROFILE,
    paneIndex: 0
  })
}

describe('sanitizeTerminalPreview — drops agent CLI boilerplate', () => {
  test.each([
    ['Tip: /skills', 'Copilot Tip line'],
    ['Tip: try /commands', 'Copilot Tip with whitespace'],
    ['  Tip:   /instructions  ', 'Tip line with extra whitespace'],
    ['Welcome to GitHub Copilot CLI', 'welcome banner'],
    ['Session resumed', 'session banner'],
    ['How can I help you today?', 'idle Claude prompt'],
    ['Waiting for your input', 'awaiting prompt'],
    ['Check for mistakes.', 'Copilot footer line'],
    ['Copilot v1.0.51 uses AI.', 'Copilot version banner'],
    ['Sonnet 4.5', 'Claude model banner'],
    ['Human: ', 'empty human role marker'],
    ['Assistant:', 'empty assistant role marker'],
    ['PS C:\\Users\\dev\\demo>', 'PowerShell prompt line'],
    ['yes', 'bare confirmation'],
    ['continue?', 'continue prompt'],
    ['cd C:\\Users\\dev\\demo', 'shell cd echo']
  ])('drops "%s" (%s)', (line) => {
    expect(sanitizeTerminalPreview(line)).toBeNull()
  })

  test('keeps a real user intent', () => {
    expect(sanitizeTerminalPreview('Fix the auth race in session.service.ts'))
      .toBe('Fix the auth race in session.service.ts')
  })

  test('strips ANSI before matching, so a coloured "Tip:" still gets dropped', () => {
    // Copilot wraps "Tip:" in colour escapes. The stripper has to run before
    // pattern matching — otherwise this regression slips back in.
    const ansiTip = '\x1B[33mTip:\x1B[0m /skills'
    expect(sanitizeTerminalPreview(ansiTip)).toBeNull()
  })

  test('keeps the last meaningful line when boilerplate sits above it', () => {
    const noisy = [
      'Welcome to GitHub Copilot CLI',
      'Check for mistakes.',
      'Refactor the SessionService to expose a streaming API'
    ].join('\n')
    expect(sanitizeTerminalPreview(noisy)).toBe('Refactor the SessionService to expose a streaming API')
  })
})

describe('derivePaneDisplayState — title fallback chain', () => {
  test('prefers the explicit displayName over everything else', () => {
    const state = deriveWith(
      { lastIntent: 'Run the failing test', lastOutput: 'Tip: /skills' },
      { displayName: 'Test repro pane' }
    )
    expect(state.title).toBe('Test repro pane')
  })

  test('falls back to lastIntent when there is no displayName', () => {
    const state = deriveWith({ lastIntent: 'Fix the auth race', lastOutput: 'Tip: /skills' })
    expect(state.title).toBe('Fix the auth race')
  })

  test('falls back to sanitized lastOutput when there is no intent', () => {
    const state = deriveWith({ lastOutput: 'Tip: /skills\nWriting tests now…' })
    expect(state.title).toBe('Writing tests now…')
  })

  test('falls back to a status fallback when neither intent nor useful output exist', () => {
    const state = deriveWith({ lastOutput: 'Tip: /skills', isWorking: false, lastActivityAt: Date.now() })
    // No intent, output is 100% boilerplate, no idle ⇒ status fallback.
    // Status tone here is 'idle' since there's no lastIntent.
    expect(state.statusTone).toBe('idle')
    expect(state.title).not.toContain('Tip:')
  })
})

describe('derivePaneDisplayState — status tone derivation', () => {
  test('isWorking maps to thinking', () => {
    expect(deriveWith({ isWorking: true }).statusTone).toBe('thinking')
  })

  test('running + recent intent maps to awaiting', () => {
    const recent = Date.now() - 1000
    const state = deriveWith({ lastIntent: 'Do something', lastIntentAt: recent, lastActivityAt: recent })
    expect(state.statusTone).toBe('awaiting')
  })

  test('running with stale (>5min) intent maps to idle', () => {
    const stale = Date.now() - 10 * 60_000
    expect(deriveWith({ lastIntent: 'something old', lastIntentAt: stale, lastActivityAt: stale }).statusTone).toBe('idle')
  })

  test('error status overrides everything else', () => {
    expect(deriveWith({ status: 'error', error: 'spawn ENOENT', isWorking: true }).statusTone).toBe('error')
  })

  test('exited status maps to exited tone', () => {
    expect(deriveWith({ status: 'exited' }).statusTone).toBe('exited')
  })

  test('starting maps to starting tone', () => {
    expect(deriveWith({ status: 'starting' }).statusTone).toBe('starting')
  })
})

describe('compactPathLabel + formatPaneStatus', () => {
  test('formats labels for all 6 tones', () => {
    expect(formatPaneStatus('thinking')).toBe('Thinking')
    expect(formatPaneStatus('awaiting')).toBe('Awaiting')
    expect(formatPaneStatus('starting')).toBe('Starting')
    expect(formatPaneStatus('exited')).toBe('Exited')
    expect(formatPaneStatus('error')).toBe('Needs attention')
    expect(formatPaneStatus('idle')).toBe('Idle')
  })

  test('compactPathLabel falls back to "workspace" for empty input', () => {
    expect(compactPathLabel(null)).toBe('workspace')
    expect(compactPathLabel('')).toBe('workspace')
  })

  test('compactPathLabel returns just the tail folder', () => {
    expect(compactPathLabel('C:/Users/dev/projects/demo-app')).toBe('demo-app')
    expect(compactPathLabel('/home/dev/projects/api')).toBe('api')
  })

  test('compactPathLabel truncates very long folder names', () => {
    const long = '/home/dev/this-is-an-extremely-long-folder-name-that-should-be-cut'
    expect(compactPathLabel(long)).toHaveLength(24)
    expect(compactPathLabel(long).endsWith('...')).toBe(true)
  })
})

describe('stripTerminalControl', () => {
  test('drops CSI / OSC / DCS sequences', () => {
    const noisy = '\x1B[31mred\x1B[0m\x1B]0;title\x07rest\x1B\\done'
    expect(stripTerminalControl(noisy)).toBe('redrestdone')
  })

  test('drops \\r so windowsy lines fold cleanly', () => {
    expect(stripTerminalControl('hello\r\nworld\r')).toBe('hello\nworld')
  })
})
