import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { OxePanel } from '../../src/components/Oxe/OxePanel'
import { useOxeStore } from '../../src/store/oxe.store'

describe('OxePanel', () => {
  beforeEach(() => {
    useOxeStore.setState({ byWorkspaceId: {} })
    window.oxe = {
      app: { version: '0.1.12' },
      workspace: {} as never,
      terminal: {} as never,
      agent: {} as never,
      tasks: {} as never,
      fs: {} as never,
      oxe: {
        getStatus: vi.fn().mockResolvedValue({
          workspaceId: 'workspace-1',
          rootPath: 'C:/repo',
          isOxeProject: true,
          engine: { available: false, version: null, command: 'oxe-cc', message: 'missing' },
          state: {
            status: 'plan_ready',
            runId: 'run-1',
            runtimeStatus: 'pending_execute',
            lifecycleStatus: 'pending_execute',
            nextStep: 'Executar oxe-execute.'
          },
          artifacts: [
            { kind: 'state', label: 'STATE', relativePath: '.oxe/STATE.md', exists: true, size: 10, mtimeMs: 1 },
            { kind: 'plan', label: 'PLAN', relativePath: '.oxe/PLAN.md', exists: true, size: 20, mtimeMs: 2 }
          ],
          warnings: [],
          updatedAt: '2026-05-09T00:00:00Z',
          healthStatus: 'warning',
          nextStep: 'plan',
          executionRationality: { executionRationalityReady: false, criticalExecutionGaps: ['IMPLEMENTATION-PACK incompleto'] },
          freshness: {
            state: 'dirty',
            reason: 'Workspace has uncommitted changes outside the current OXE view.',
            lastStatusAt: null,
            latestWorkspaceMtimeMs: 1,
            dirtyFiles: ['M src/App.tsx'],
            suggestedActions: [{ label: 'Refresh status', command: 'npx oxe-cc status --json', mode: 'terminal' }]
          }
        }),
        getStatusJson: vi.fn().mockImplementation((input) => window.oxe.oxe.getStatus(input)),
        listArtifacts: vi.fn().mockResolvedValue([])
        ,
        listArtifactsRich: vi.fn().mockResolvedValue([]),
        getFreshness: vi.fn().mockResolvedValue({
          state: 'fresh',
          reason: null,
          lastStatusAt: null,
          latestWorkspaceMtimeMs: null,
          dirtyFiles: [],
          suggestedActions: []
        }),
        onWorkspaceDrift: vi.fn()
      }
    }
  })

  test('renders read-only OXE status and opens artifacts', async () => {
    const user = userEvent.setup()
    const onOpenArtifact = vi.fn()
    const onRunOxeCommand = vi.fn()

    render(
      <OxePanel
        workspaceId="workspace-1"
        rootPath="C:/repo"
        onOpenArtifact={onOpenArtifact}
        onRunOxeCommand={onRunOxeCommand}
      />
    )

    expect(await screen.findByText('OXE project')).toBeInTheDocument()
    expect(screen.getByText('warning')).toBeInTheDocument()
    expect(screen.getByText('optional missing')).toBeInTheDocument()
    expect(screen.getByText('blocked')).toBeInTheDocument()
    expect(screen.getByText('dirty')).toBeInTheDocument()
    expect(screen.getByText(/IMPLEMENTATION-PACK incompleto/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /PLAN/i }))
    await user.click(screen.getByRole('button', { name: /Status in terminal/i }))

    expect(onOpenArtifact).toHaveBeenCalledWith('.oxe/PLAN.md')
    expect(onRunOxeCommand).toHaveBeenCalledWith('npx oxe-cc status --json')
  })

  test('renders non-OXE empty state without blocking refresh', async () => {
    vi.mocked(window.oxe.oxe.getStatus).mockResolvedValueOnce({
      workspaceId: 'workspace-1',
      rootPath: 'C:/repo',
      isOxeProject: false,
      engine: { available: false, version: null, command: 'oxe-cc', message: 'missing' },
      state: null,
      artifacts: [],
      warnings: [],
      updatedAt: '2026-05-09T00:00:00Z',
      freshness: {
        state: 'fresh',
        reason: null,
        lastStatusAt: null,
        latestWorkspaceMtimeMs: null,
        dirtyFiles: [],
        suggestedActions: []
      }
    })

    render(<OxePanel workspaceId="workspace-1" rootPath="C:/repo" onOpenArtifact={() => undefined} onRunOxeCommand={() => undefined} />)

    await waitFor(() => expect(window.oxe.oxe.getStatus).toHaveBeenCalled())
    expect(screen.getByText('Not configured')).toBeInTheDocument()
    expect(screen.getByText('No OXE artifacts found')).toBeInTheDocument()
  })
})
