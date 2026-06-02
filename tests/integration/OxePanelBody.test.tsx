import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Workspace } from '../../shared/types/workspace'
import type { OxeStatusResult, OxeSummaryResult } from '../../shared/types/oxe'
import { OxePanelBody } from '../../src/components/Oxe/OxePanelBody'
import { useOxeStore } from '../../src/store/oxe.store'
import { useTerminalStore } from '../../src/store/terminal.store'

const workspace = {
  id: 'ws-1',
  name: 'repo',
  rootPath: 'C:/repo',
  panes: [
    { id: 'pane-1', workspaceId: 'ws-1', type: 'terminal', rowIndex: 0, columnIndex: 0, shellProfileId: null, status: 'running', agentProfileId: null, agentName: null, displayName: null, createdAt: null, rootPath: null }
  ]
} as unknown as Workspace

/** Wires window.oxe.oxe with the full surface the panel/store touch. */
function mockOxe(opts: { summary?: Partial<OxeSummaryResult>; status?: OxeStatusResult }): void {
  const summary: OxeSummaryResult = {
    installed: true,
    version: '1.14.0',
    isOxeProject: true,
    summary: null,
    supportsSummary: true,
    error: null,
    ...opts.summary
  }
  const status: OxeStatusResult = opts.status ?? { installed: summary.installed, version: summary.version, isOxeProject: summary.isOxeProject, status: null, error: null }
  ;(window as unknown as { oxe: { oxe: Record<string, ReturnType<typeof vi.fn>> } }).oxe = {
    oxe: {
      detect: vi.fn().mockResolvedValue({ installed: summary.installed, version: summary.version }),
      status: vi.fn().mockResolvedValue(status),
      statusSummary: vi.fn().mockResolvedValue(summary),
      openDashboard: vi.fn().mockResolvedValue({ ok: true, error: null }),
      startDashboard: vi.fn().mockResolvedValue({ ok: true, url: 'http://127.0.0.1:50000/', port: 50000, mode: 'embedded', error: null }),
      stopDashboard: vi.fn().mockResolvedValue({ ok: true }),
      watchEvents: vi.fn().mockResolvedValue({ ok: true }),
      unwatchEvents: vi.fn().mockResolvedValue({ ok: true }),
      onEventsChanged: vi.fn().mockReturnValue(() => {})
    }
  } as never
}

describe('OxePanelBody', () => {
  beforeEach(() => {
    useOxeStore.setState({ byRoot: {}, summaryByRoot: {}, loading: {}, summaryLoading: {}, dashboardByRoot: {}, lastUpdatedAt: {} })
    useTerminalStore.setState({ panes: {}, pendingCommands: {}, activePaneId: 'pane-1' })
  })

  test('onboarding when oxe-cc is not installed', async () => {
    mockOxe({ summary: { installed: false, version: null, isOxeProject: false, supportsSummary: false } })
    render(<OxePanelBody workspace={workspace} />)
    expect(await screen.findByText(/OXE não detectado/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Instalar OXE/i })).toBeInTheDocument()
  })

  test('install CTA injects the install command into the active terminal', async () => {
    mockOxe({ summary: { installed: false, version: null, isOxeProject: false, supportsSummary: false } })
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    render(<OxePanelBody workspace={workspace} />)
    const btn = await screen.findByRole('button', { name: /Instalar OXE/i })
    await userEvent.click(btn)
    const ev = dispatchSpy.mock.calls.map((c) => c[0]).find((e) => e.type === 'oxe:terminal-insert-text') as CustomEvent
    expect(ev?.detail).toMatchObject({ paneId: 'pane-1', text: 'npm install -g oxe-cc' })
  })

  test('onboarding when installed but not an OXE project', async () => {
    mockOxe({ summary: { installed: true, version: '1.14.0', isOxeProject: false } })
    render(<OxePanelBody workspace={workspace} />)
    expect(await screen.findByText(/ainda não usa OXE/i)).toBeInTheDocument()
  })

  test('summary drives the live band + next step injects cursorCmd', async () => {
    mockOxe({
      summary: {
        summary: { oxeSummarySchema: 1, healthStatus: 'warning', phase: 'execute', activeSession: 's003', nextStep: 'execute', cursorCmd: '/oxe-execute', reason: 'continuar a onda', warningsCount: 1, eventsCount: 5, agentSkills: [] }
      },
      status: { installed: true, version: '1.14.0', isOxeProject: true, status: { healthStatus: 'warning', phase: 'execute', criticalExecutionGaps: ['T1 sem symbols'] }, error: null }
    })
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    render(<OxePanelBody workspace={workspace} />)

    expect(await screen.findByText('warning')).toBeInTheDocument()
    expect(screen.getByText(/Fase: execute/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('T1 sem symbols')).toBeInTheDocument())

    await userEvent.click(screen.getByText('/oxe-execute'))
    const ev = dispatchSpy.mock.calls.map((c) => c[0]).find((e) => e.type === 'oxe:terminal-insert-text') as CustomEvent
    expect(ev?.detail).toMatchObject({ paneId: 'pane-1', text: '/oxe-execute' })
  })

  test('missing agent skills surface a card whose CTA injects the install command', async () => {
    mockOxe({
      summary: {
        summary: { oxeSummarySchema: 1, healthStatus: 'healthy', phase: 'plan', agentSkills: [{ agent: 'copilot-cli', skillsInstalled: false }] }
      }
    })
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent')
    render(<OxePanelBody workspace={workspace} />)

    expect(await screen.findByText(/Copilot CLI/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Instalar skills/i }))
    const ev = dispatchSpy.mock.calls.map((c) => c[0]).find((e) => e.type === 'oxe:terminal-insert-text') as CustomEvent
    expect(ev?.detail).toMatchObject({ paneId: 'pane-1', text: 'oxe install --copilot-cli' })
  })

  test('degrades gracefully when oxe-cc lacks --summary (falls back to full status)', async () => {
    mockOxe({
      summary: { installed: true, version: '1.12.0', isOxeProject: true, summary: null, supportsSummary: false },
      status: { installed: true, version: '1.12.0', isOxeProject: true, status: { healthStatus: 'healthy', phase: 'spec', cursorCmd: '/oxe-spec' }, error: null }
    })
    render(<OxePanelBody workspace={workspace} />)
    expect(await screen.findByText('healthy')).toBeInTheDocument()
    expect(screen.getByText(/Fase: spec/)).toBeInTheDocument()
    expect(screen.getByText('/oxe-spec')).toBeInTheDocument()
  })
})
