import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SHELL_COMMAND_OSC_MAX_PENDING, ShellCommandOscScanner } from '../../electron/main/services/terminal/shell-command-osc'
import type { TerminalActivityEvent } from '../../shared/types/ipc/terminal'
import type { Workspace, WorkspacePane } from '../../shared/types/workspace'
import { changeLanguage } from '../../src/i18n'
import { useTerminalStore } from '../../src/store/terminal.store'
import { useWorkspaceStore } from '../../src/store/workspace.store'
import { useUIStore } from '../../src/store/ui.store'
import { preloadOxe } from '../acceptance/f4/crf4-8-preload'

vi.mock('../../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: 'main', detached: false, shortSha: null, error: null }) }))
vi.mock('../../src/components/Terminal/TerminalView', () => ({ TerminalView: () => createElement('div', { 'data-testid': 'xterm-stub' }) }))

const ESC = '\u001b'
const BEL = '\u0007'
const ST = `${ESC}\\`

const shellPane: WorkspacePane = {
  id: 'shell-1', workspaceId: 'ws-1', type: 'terminal', rowIndex: 0, columnIndex: 0,
  status: 'running', agentProfileId: null, agentName: null, displayName: null,
  shellProfileId: null, rootPath: null, createdAt: null
}
const workspace = {
  id: 'ws-1', name: 'demo', rootPath: '/repo', defaultShellProfileId: '', panes: [shellPane]
} as unknown as Workspace

beforeEach(async () => {
  await changeLanguage('en')
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-density')
  useTerminalStore.setState({
    panes: {
      'shell-1': {
        status: 'running', error: null, lastActivityAt: null, lastOutput: null,
        lastIntent: null, lastIntentAt: null, isWorking: false, hasUnread: false,
        hookState: null, hookAt: null, agentState: null, agentSource: null,
        agentName: null, location: null, shellCommand: null, detached: false
      }
    },
    activePaneId: 'shell-1'
  })
  useUIStore.setState({ activePaneId: 'shell-1' } as never)
  useWorkspaceStore.setState({ workspaces: [workspace], shellProfiles: [] } as never)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('OXE-272 · OSC 633/133 shell command duration and outcome', () => {
  it('parses OSC 633;C and OSC 133;C command start and exposes elapsed time in PaneContainer across themes and densities', async () => {
    let clock = 10_000
    const scanner = new ShellCommandOscScanner(() => clock)
    expect(scanner.current()).toBeNull()
    expect(scanner.push('plain shell output without osc')).toBeNull()

    // OSC 633;C (BEL)
    expect(scanner.push(`prompt$ ${ESC}]633;C${BEL}`)).toEqual({ running: true, startedAt: 10_000 })
    expect(scanner.current()).toEqual({ running: true, startedAt: 10_000 })

    // OSC 133;C (ST)
    clock = 25_000
    expect(scanner.push(`${ESC}]133;C${ST}`)).toEqual({ running: true, startedAt: 25_000 })

    const listeners = new Set<(event: TerminalActivityEvent) => void>()
    preloadOxe({ 'terminal.branch': () => ({ branch: 'main', startedOn: 'main', switched: false }) })
    window.oxe.terminal.onActivity = ((paneId: string, listener: (event: TerminalActivityEvent) => void) => {
      if (paneId === 'shell-1') listeners.add(listener)
      return () => { listeners.delete(listener) }
    }) as typeof window.oxe.terminal.onActivity

    const { PaneContainer } = await import('../../src/components/Grid/PaneContainer')
    const cases = [
      { theme: 'light', density: 'compact', ageMs: 45_000, expected: '45s' },
      { theme: 'dark', density: 'compact', ageMs: 12 * 60_000, expected: '12m' },
      { theme: 'light', density: 'comfortable', ageMs: 65 * 60_000, expected: '1h 05m' },
      { theme: 'dark', density: 'comfortable', ageMs: 45_000, expected: '45s' }
    ] as const

    for (const c of cases) {
      document.documentElement.setAttribute('data-theme', c.theme)
      document.documentElement.setAttribute('data-density', c.density)
      const startedAt = Date.now() - c.ageMs
      const view = render(createElement(PaneContainer, {
        pane: shellPane, workspace, agentProfile: null, autoStart: false, isMaximized: false, onToggleMaximize: () => undefined
      }))
      act(() => {
        for (const fn of listeners) fn({ paneId: 'shell-1', at: Date.now(), bytes: 0, command: { running: true, startedAt } })
      })
      await waitFor(() => {
        const badge = view.container.querySelector('[data-testid="pane-command-status"]')
        expect(badge).not.toBeNull()
        expect(badge).toHaveAttribute('data-ui', 'pane-running-time')
        expect(badge).toHaveAttribute('data-state', 'running')
        expect(badge?.textContent).toBe(c.expected)
      })
      expect(view.container.querySelector('[data-ui="pane-header"]')).not.toBeNull()
      expect(view.container.querySelector('[data-ui="pane-title"]')).not.toBeNull()
      cleanup()
    }
  })

  it('stops timer and emits success/failure outcome on OSC 633;D and OSC 133;D including chunked escape sequences', async () => {
    let clock = 1_000
    const scanner = new ShellCommandOscScanner(() => clock)

    // Initial OSC 633;D without code before any command ran emits nothing (RT-3).
    expect(scanner.push(`${ESC}]633;D${BEL}`)).toBeNull()
    expect(scanner.current()).toBeNull()

    // Chunked OSC 633;C (split between ESC and ]) then chunked OSC 633;D;0 (BEL).
    expect(scanner.push(`hello${ESC}`)).toBeNull()
    expect(scanner.push(`]633;C${BEL}`)).toEqual({ running: true, startedAt: 1_000 })
    clock = 46_000
    expect(scanner.push(`done${ESC}]633;D;`)).toBeNull()
    const okState = scanner.push(`0${BEL}`)
    expect(okState).toEqual({ running: false, startedAt: 1_000, finishedAt: 46_000, exitCode: 0 })

    // Chunked OSC 133;C (ST) then chunked OSC 133;D;2 (ST split between ESC and \).
    clock = 50_000
    expect(scanner.push(`${ESC}]133;C${ESC}`)).toBeNull()
    expect(scanner.push(`\\`)).toEqual({ running: true, startedAt: 50_000 })
    clock = 62_000
    expect(scanner.push(`${ESC}]133;D;2;aid=9${ESC}`)).toBeNull()
    const failState = scanner.push(`\\`)
    expect(failState).toEqual({ running: false, startedAt: 50_000, finishedAt: 62_000, exitCode: 2 })

    // RT-3: OSC 633;D without numeric exit code stops timer without marking failure.
    clock = 70_000
    expect(scanner.push(`${ESC}]633;C${BEL}`)).toEqual({ running: true, startedAt: 70_000 })
    clock = 75_000
    const cancelledState = scanner.push(`${ESC}]633;D${BEL}`)
    expect(cancelledState).toEqual({ running: false, startedAt: 70_000, finishedAt: 75_000 })
    expect(cancelledState?.exitCode).toBeUndefined()

    // Risco 1: bounded pending buffer (512 bytes) drops runaway unterminated ESC ].
    expect(scanner.push(`${ESC}]${'x'.repeat(SHELL_COMMAND_OSC_MAX_PENDING + 20)}`)).toBeNull()
    expect(scanner.pendingLength()).toBe(0)

    // Verify PaneContainer renders semantic states and freezes final duration, and CSS uses semantic tokens.
    const paneCss = readFileSync('src/styles/features/pane.css', 'utf8')
    expect(paneCss).toMatch(/\.pane-command-meta\[data-state='success'\]\s*\{\s*color:\s*var\(--intent-success-fg\)/)
    expect(paneCss).toMatch(/\.pane-command-meta\[data-state='failure'\]\s*\{\s*color:\s*var\(--intent-danger-fg\)/)

    preloadOxe({ 'terminal.branch': () => ({ branch: 'main', startedOn: 'main', switched: false }) })
    const { PaneContainer } = await import('../../src/components/Grid/PaneContainer')

    useTerminalStore.getState().setShellCommand('shell-1', okState)
    const okView = render(createElement(PaneContainer, {
      pane: shellPane, workspace, agentProfile: null, autoStart: false, isMaximized: false, onToggleMaximize: () => undefined
    }))
    const okBadge = okView.container.querySelector('[data-testid="pane-command-status"]')
    expect(okBadge).toHaveAttribute('data-state', 'success')
    expect(okBadge).toHaveAttribute('data-exit-code', '0')
    expect(okBadge?.textContent).toBe('45s')
    cleanup()

    useTerminalStore.getState().setShellCommand('shell-1', failState)
    const failView = render(createElement(PaneContainer, {
      pane: shellPane, workspace, agentProfile: null, autoStart: false, isMaximized: false, onToggleMaximize: () => undefined
    }))
    const failBadge = failView.container.querySelector('[data-testid="pane-command-status"]')
    expect(failBadge).toHaveAttribute('data-state', 'failure')
    expect(failBadge).toHaveAttribute('data-exit-code', '2')
    expect(failBadge?.getAttribute('title')).toContain('2')
    expect(failBadge?.getAttribute('aria-label')).toContain('2')
    expect(failBadge?.textContent).toBe('12s')
    cleanup()

    useTerminalStore.getState().setShellCommand('shell-1', cancelledState)
    const cancelView = render(createElement(PaneContainer, {
      pane: shellPane, workspace, agentProfile: null, autoStart: false, isMaximized: false, onToggleMaximize: () => undefined
    }))
    const cancelBadge = cancelView.container.querySelector('[data-testid="pane-command-status"]')
    expect(cancelBadge).toHaveAttribute('data-state', 'finished')
    expect(cancelBadge?.getAttribute('data-exit-code')).toBeNull()
    expect(cancelBadge?.textContent).toBe('5s')
  })

  it('renders nothing in PaneContainer header when shell emits no OSC 633/133 markers', async () => {
    preloadOxe({ 'terminal.branch': () => ({ branch: 'main', startedOn: 'main', switched: false }) })
    const { PaneContainer } = await import('../../src/components/Grid/PaneContainer')

    // Plain shell with normal output and intent, but zero OSC 633/133 markers.
    useTerminalStore.getState().setLastIntent('shell-1', 'npm test')
    useTerminalStore.getState().updateActivity('shell-1', 'running tests...\r\n')
    const view = render(createElement(PaneContainer, {
      pane: shellPane, workspace, agentProfile: null, autoStart: false, isMaximized: false, onToggleMaximize: () => undefined
    }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)) })
    expect(view.container.querySelectorAll('[data-ui="pane-running-time"]')).toHaveLength(0)
    expect(view.container.querySelectorAll('[data-testid="pane-command-status"]')).toHaveLength(0)
    const headerText = view.container.querySelector('[data-ui="pane-header"]')?.textContent ?? ''
    expect(headerText).not.toContain('—')
    expect(headerText).not.toContain('0s')
    cleanup()

    // OXE-428: Agent pane omits header elapsed timer and shell command badge even when agentState.since or shellCommand exist.
    const since = Date.now() - 120_000
    preloadOxe({
      'terminal.branch': () => ({ branch: 'main', startedOn: 'main', switched: false }),
      'agentState.list': () => [{ paneId: 'agent-1', workspaceId: 'ws-1', agent: 'claude', state: 'working', source: 'hook', seen: true, since, stateChangeSeq: 1, completionSeq: 0 }]
    })
    const agentPane: WorkspacePane = { ...shellPane, id: 'agent-1', agentProfileId: 'builtin-agent-claude', agentName: 'Claude' }
    const agentWs = { ...workspace, panes: [agentPane] } as unknown as Workspace
    useWorkspaceStore.setState({ workspaces: [agentWs], shellProfiles: [] } as never)
    useTerminalStore.getState().setShellCommand('agent-1', { running: true, startedAt: Date.now() - 5_000 })
    const agentView = render(createElement(PaneContainer, {
      pane: agentPane, workspace: agentWs, agentProfile: null, autoStart: false, isMaximized: false, onToggleMaximize: () => undefined
    }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)) })
    expect(agentView.container.querySelectorAll('[data-ui="pane-running-time"]')).toHaveLength(0)
    expect(agentView.container.querySelectorAll('[data-testid="pane-command-status"]')).toHaveLength(0)
  })
})
