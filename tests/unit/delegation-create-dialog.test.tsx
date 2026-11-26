import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { DelegationCreateDialog } from '../../src/components/Delegation/DelegationCreateDialog'
import { DelegatedWorkDialog } from '../../src/components/Delegation/DelegatedWorkDialog'
import { changeLanguage } from '../../src/i18n'
import type { ConversationThread } from '../../shared/types/thread'
import type { DelegationPreflight, DelegationTask } from '../../shared/types/delegation'

function mockOxeApi(options?: {
  sessions?: ConversationThread[]
  previewResult?: DelegationPreflight
}) {
  const preview = vi.fn(async (_wsId: string, _objective: string, intent: { name?: string }) => options?.previewResult ?? {
    previewId: 'prev-1',
    targetWorkspaceId: 'ws-1',
    targetName: 'repo',
    ready: true,
    reason: null,
    checkout: {
      strategy: 'create',
      branch: intent.name ?? 'oxe/generated-1234',
      baseRef: 'main',
      baseSha: 'abcdef1234567890',
      path: '/worktrees/feature-auth',
      createBranch: true,
      reuseExistingWorktree: false,
      fetchBase: false,
      resolvedAt: Date.now()
    },
    effects: []
  })
  const create = vi.fn(async () => ({ id: 'task-1' } as DelegationTask))
  const status = vi.fn(async () => ({ enabled: true, tasks: [], targets: [], nextCursor: null }))
  const listThreads = vi.fn(async () => options?.sessions ?? [])
  const listAgents = vi.fn(async () => [
    { agentProfileId: 'claude-builtin', provider: 'claude', name: 'Claude', command: 'claude', isBuiltin: true },
    { agentProfileId: 'codex-builtin', provider: 'codex', name: 'Codex', command: 'codex', isBuiltin: true }
  ])
  Object.assign(window, {
    oxe: {
      agent: { list: listAgents },
      thread: { list: listThreads },
      delegation: {
        status,
        preview,
        create,
        onChanged: vi.fn(() => () => undefined),
        control: vi.fn(async () => undefined),
        adopt: vi.fn(async () => undefined)
      }
    }
  })
  return { preview, create, status, listThreads, listAgents }
}

const sampleSession = (id: string, title: string): ConversationThread => ({
  id,
  workspaceId: 'ws-1',
  projectId: 'proj-1',
  rootPath: '/repo',
  provider: 'claude',
  nativeSessionId: null,
  title,
  pinned: false,
  status: 'idle',
  createdAt: 1,
  updatedAt: Date.UTC(2026, 9, 14)
} as ConversationThread)

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  await changeLanguage('en')
})

describe('OXE-422 · DelegationCreateDialog redesign with src/ui primitives', () => {
  test('renders src/ui primitives, required markers, exact accessible labels, and collapses Knowledge when no sessions exist', async () => {
    mockOxeApi({ sessions: [] })
    render(<DelegationCreateDialog workspaceId="ws-1" origin={{ kind: 'pane', id: 'p-1' }} onClose={() => undefined} />)

    const dialog = await screen.findByRole('dialog', { name: 'Delegate work' })

    // Exact label matching (preserves Playwright getByLabel(..., { exact: true }) contract) + required attributes
    const objective = within(dialog).getByLabelText('Objective', { exact: true })
    const handoff = within(dialog).getByLabelText('Handoff', { exact: true })
    const acceptance = within(dialog).getByLabelText('Acceptance criteria', { exact: true })
    const exactBranch = within(dialog).getByLabelText('Exact branch', { exact: true })
    expect(objective).toBeRequired()
    expect(handoff).toBeRequired()
    expect(acceptance).toBeRequired()
    expect(exactBranch).toBeRequired()
    expect(dialog.querySelectorAll('[data-required="true"]')).toHaveLength(4)

    // SegmentedControl for branch strategy (no raw fieldset/radio inputs)
    const strategyGroup = within(dialog).getByRole('radiogroup', { name: 'Branch strategy' })
    expect(strategyGroup).toHaveAttribute('data-ui', 'segmented-control')
    expect(dialog.querySelector('fieldset')).toBeNull()
    expect(dialog.querySelector('input[type="radio"]')).toBeNull()
    expect(within(strategyGroup).getByRole('radio', { name: 'New branch' })).toHaveAttribute('aria-checked', 'true')

    // Knowledge to transfer stays collapsed by default when sessions.length === 0
    await waitFor(() => {
      const knowledge = dialog.querySelector('details.delegation-sources')
      expect(knowledge).not.toBeNull()
      expect(knowledge).not.toHaveAttribute('open')
    })

    // Preview checkout lives in the Checkout preview card as a secondary button, not a ghost button in the footer
    const previewButtons = within(dialog).getAllByRole('button', { name: 'Preview checkout' })
    expect(previewButtons).toHaveLength(1)
    expect(previewButtons[0]).toHaveAttribute('data-variant', 'secondary')
    expect(previewButtons[0]).toBeDisabled()
    const footer = dialog.querySelector('[data-dialog-footer]')!
    expect(within(footer as HTMLElement).queryByRole('button', { name: 'Preview checkout' })).toBeNull()
    expect(within(footer as HTMLElement).getByText('Complete the required fields and preview checkout to continue.')).toBeInTheDocument()
  })

  test('auto-expands Knowledge to transfer when saved conversations exist and lets users toggle checkboxes', async () => {
    const user = userEvent.setup()
    mockOxeApi({
      sessions: [
        sampleSession('s-1', 'Auth architecture notes'),
        sampleSession('s-2', 'Token rotation thread')
      ]
    })
    render(<DelegationCreateDialog workspaceId="ws-1" origin={{ kind: 'pane', id: 'p-1' }} onClose={() => undefined} />)

    const dialog = await screen.findByRole('dialog', { name: 'Delegate work' })
    await waitFor(() => {
      expect(dialog.querySelector('details.delegation-sources')).toHaveAttribute('open')
    })
    const firstSession = within(dialog).getByRole('checkbox', { name: /Auth architecture notes/ })
    const memory = within(dialog).getByRole('checkbox', { name: /Include relevant AI Memory/ })
    expect(firstSession).not.toBeChecked()
    expect(memory).toBeChecked()
    await user.click(firstSession)
    expect(firstSession).toBeChecked()
  })

  test('guides the user smoothly from Preview checkout to Create delegation and invalidates preview on edits', async () => {
    const user = userEvent.setup()
    const { preview, create } = mockOxeApi({ sessions: [] })
    const onClose = vi.fn()
    const onCreated = vi.fn()
    render(<DelegationCreateDialog workspaceId="ws-1" origin={{ kind: 'pane', id: 'p-1' }} onClose={onClose} onCreated={onCreated} />)

    const dialog = await screen.findByRole('dialog', { name: 'Delegate work' })
    const createBtn = within(dialog).getByRole('button', { name: 'Create delegation' })
    expect(createBtn).toBeDisabled()

    await user.type(within(dialog).getByLabelText('Objective', { exact: true }), 'Implement OAuth callback')
    await user.type(within(dialog).getByLabelText('Exact branch', { exact: true }), 'feature/oauth-callback')

    expect(within(dialog).getByText('Preview checkout to enable creating the delegation.')).toBeInTheDocument()
    const previewBtn = within(dialog).getByRole('button', { name: 'Preview checkout' })
    expect(previewBtn).toBeEnabled()

    await user.click(previewBtn)
    expect(preview).toHaveBeenCalledTimes(1)
    expect(await within(dialog).findByText('Ready to delegate')).toBeInTheDocument()
    expect(within(dialog).getByText('feature/oauth-callback')).toBeInTheDocument()
    expect(within(dialog).getByText('/worktrees/feature-auth')).toBeInTheDocument()
    expect(within(dialog).getByText('Complete Handoff and Acceptance criteria to create.')).toBeInTheDocument()
    expect(createBtn).toBeDisabled()

    await user.type(within(dialog).getByLabelText('Handoff', { exact: true }), 'Keep PKCE verification')
    await user.type(within(dialog).getByLabelText('Acceptance criteria', { exact: true }), 'Unit tests pass')
    expect(createBtn).toBeEnabled()

    // Editing branch resets preview back to pending card
    await user.type(within(dialog).getByLabelText('Exact branch', { exact: true }), '-v2')
    expect(within(dialog).queryByText('Ready to delegate')).toBeNull()
    expect(within(dialog).getByText('Checkout preview')).toBeInTheDocument()
    expect(createBtn).toBeDisabled()

    // Re-preview and create
    await user.click(within(dialog).getByRole('button', { name: 'Preview checkout' }))
    expect(await within(dialog).findByText('Ready to delegate')).toBeInTheDocument()
    await user.click(createBtn)
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(onCreated).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('switching branch strategy via SegmentedControl updates required branch indicator and fields', async () => {
    const user = userEvent.setup()
    mockOxeApi({ sessions: [] })
    render(<DelegationCreateDialog workspaceId="ws-1" origin={{ kind: 'pane', id: 'p-1' }} onClose={() => undefined} />)

    const dialog = await screen.findByRole('dialog', { name: 'Delegate work' })
    await user.click(within(dialog).getByRole('radio', { name: 'Generated' }))
    expect(within(dialog).queryByLabelText('Exact branch', { exact: true })).toBeNull()
    expect(within(dialog).getByLabelText('Reference (optional)')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Template')).toBeInTheDocument()
    expect(dialog.querySelectorAll('[data-required="true"]')).toHaveLength(3)

    await user.type(within(dialog).getByLabelText('Objective', { exact: true }), 'Refactor parser')
    expect(within(dialog).getByRole('button', { name: 'Preview checkout' })).toBeEnabled()
  })

  test('renders pt-BR copy cleanly with no untranslated English labels', async () => {
    await changeLanguage('pt-BR')
    mockOxeApi({ sessions: [] })
    render(<DelegationCreateDialog workspaceId="ws-1" origin={{ kind: 'pane', id: 'p-1' }} onClose={() => undefined} />)

    const dialog = await screen.findByRole('dialog', { name: 'Delegar trabalho' })
    expect(within(dialog).getByText('Prévia do checkout')).toBeInTheDocument()
    expect(within(dialog).getByText('Não conferido')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Conferir checkout' })).toBeInTheDocument()
    expect(within(dialog).getByText('Preencha os campos obrigatórios e confira o checkout para continuar.')).toBeInTheDocument()
  })
})

describe('OXE-422 · DelegatedWorkDialog visual primitives alignment', () => {
  test('uses SearchInput, Badge, card surfaces, and secondary action buttons (zero ghost task actions)', async () => {
    const task = {
      id: 't-1',
      workspaceId: 'ws-1',
      originWorkspaceId: 'ws-1',
      objective: 'Verify checkout flow',
      branch: 'feature/verify-checkout',
      state: 'interrupted',
      agentProfileId: 'claude',
      surface: 'thread',
      destinationThreadId: 'th-2',
      updatedAt: Date.UTC(2026, 9, 14),
      path: '/wt/verify',
      baseSha: '1234567890ab',
      cwd: '/repo',
      handoff: 'Run checks',
      recoveryActions: ['open', 'resume', 'cancel']
    }
    Object.assign(window, {
      oxe: {
        delegation: {
          status: vi.fn(async () => ({ enabled: true, tasks: [task], nextCursor: null })),
          onChanged: vi.fn(() => () => undefined),
          control: vi.fn(async () => undefined),
          adopt: vi.fn(async () => undefined)
        }
      }
    })
    render(
      <DelegatedWorkDialog
        workspaces={[{ id: 'ws-1', name: 'repo' } as never]}
        workspaceId="ws-1"
        origin={{ kind: 'thread', id: 'th-1' }}
        onClose={() => undefined}
        onOpen={async () => true}
      />
    )

    const dialog = await screen.findByRole('dialog', { name: 'Delegated work' })
    expect(dialog.querySelector('[data-ui="search-input"]')).not.toBeNull()
    const card = (await within(dialog).findByText('Verify checkout flow')).closest('article')!
    expect(card).toHaveClass('delegated-work-card')
    const actionButtons = [...card.querySelectorAll('.delegated-work-actions button')]
    expect(actionButtons.length).toBeGreaterThanOrEqual(4)
    for (const btn of actionButtons) {
      expect(btn).toHaveAttribute('data-variant', 'secondary')
    }
  })
})
