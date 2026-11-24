// Frozen acceptance test for OXE-368 A3, A4 (program 152sec, phase F1). Written by the planner; the executor must not edit it.
// Closing asks when an agent works (or waits for a decision) in an OxeCode terminal, in any workspace, mounted or
// detached, and when a background job runs. A plain shell that prints, and an agent that finished, do not hold the window.
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CloseAnswerInput } from '../../../shared/types/app'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { confirmClose, handleCloseRequest } from '../../../src/lib/closeGuard'
import { resetUnsavedSourcesForTests } from '../../../src/lib/unsavedWork'
import { useTerminalStore, type TerminalStateEntry } from '../../../src/store/terminal.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'

const original = window.oxe
const answers: Array<CloseAnswerInput['answer']> = []
let jobs: Record<string, Array<Record<string, unknown>>> = {}

const pane = (id: string, agentName: string | null, workspaceId: string): WorkspacePane =>
  ({ id, workspaceId, type: 'terminal', rowIndex: 0, columnIndex: 0, status: 'running', agentProfileId: agentName ? `profile-${id}` : null, agentName, displayName: null, shellProfileId: 'builtin-powershell', rootPath: null, createdAt: null } as WorkspacePane)
const terminal = (over: Partial<TerminalStateEntry>): TerminalStateEntry =>
  ({ status: 'running', error: null, lastActivityAt: null, lastOutput: null, lastIntent: null, lastIntentAt: null, isWorking: false, hasUnread: false, hookState: null, hookAt: null, agentState: null, agentSource: null, agentName: null, location: null, shellCommand: null, detached: false, ...over })

function app(panes: WorkspacePane[], states: Record<string, TerminalStateEntry>): void {
  const workspaces = ['ws-front', 'ws-back'].map(id => ({ id, name: id, rootPath: `C:/dev/${id}`, panes: panes.filter(item => item.workspaceId === id), shellProfiles: [] }) as unknown as Workspace)
  useWorkspaceStore.setState({ workspaces, activeWorkspaceId: 'ws-front' })
  useTerminalStore.setState({ panes: states })
}

beforeAll(async () => { await import('../../../src/components/CloseGuard/UnsavedWorkDialog') }, 30_000)
beforeEach(() => {
  answers.length = 0
  jobs = {}
  resetUnsavedSourcesForTests()
  window.oxe = {
    ...original,
    app: { ...(original?.app ?? {}), answerClose: vi.fn(async (input: CloseAnswerInput) => { answers.push(input.answer) }) },
    thread: { list: vi.fn(async () => []) },
    background: { list: vi.fn(async (workspaceId: string) => jobs[workspaceId] ?? []) }
  } as unknown as typeof window.oxe
  app([], {})
})
afterEach(async () => {
  for (const button of screen.queryAllByRole('button', { name: 'Cancel' })) fireEvent.click(button)
  cleanup()
  await waitFor(() => expect(screen.queryByTestId('unsaved-work-dialog')).toBeNull())
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null })
  useTerminalStore.setState({ panes: {} })
  window.oxe = original
})

/** Asks to close, and returns what the window did first: the dialog, or the close going on. */
async function close(id: string): Promise<{ closing: Promise<void>; first: string }> {
  const closing = handleCloseRequest({ requestId: id, reason: 'close' })
  await waitFor(() => expect(answers.length).toBeGreaterThan(0), { timeout: 5_000 })
  return { closing, first: answers[0] }
}

describe('OXE-368 · closing with work running in OxeCode', () => {
  it('closing asks while a terminal agent works, in any workspace', async () => {
    app([pane('p1', 'Claude', 'ws-back')], { p1: terminal({ agentState: 'working', detached: true }) })
    const { closing, first } = await close('c1')
    expect(first).toBe('hold')
    const dialog = await screen.findByTestId('unsaved-work-dialog', {}, { timeout: 5_000 })
    expect(dialog).toHaveTextContent('Claude')
    // Nothing here is a conversation, so the dialog must not say one is.
    expect(dialog).not.toHaveTextContent(/conversation/i)
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await closing
    expect(answers).toEqual(['hold', 'cancel'])
  }, 15_000)

  it('closing asks while a terminal agent waits for a decision', async () => {
    app([pane('p2', 'Codex', 'ws-front')], { p2: terminal({ agentState: 'blocked' }) })
    const { closing, first } = await close('c2')
    expect(first).toBe('hold')
    expect(await screen.findByTestId('unsaved-work-dialog', {}, { timeout: 5_000 })).toHaveTextContent('Codex')
    fireEvent.click(screen.getByTestId('running-turns-proceed'))
    await closing
    expect(answers).toEqual(['hold', 'proceed'])
  }, 15_000)

  it('closing asks while a background job runs', async () => {
    jobs['ws-back'] = [{ id: 'j1', workspaceId: 'ws-back', label: 'Nightly import', command: 'node import.js', status: 'running' }]
    const { closing, first } = await close('c3')
    expect(first).toBe('hold')
    expect(await screen.findByTestId('unsaved-work-dialog', {}, { timeout: 5_000 })).toHaveTextContent('Nightly import')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await closing
  }, 15_000)

  it('File Exit asks while a terminal agent works', async () => {
    app([pane('p3', 'Claude', 'ws-front')], { p3: terminal({ agentState: 'working' }) })
    let settled: boolean | null = null
    const asked = confirmClose('quit').then(value => { settled = value; return value })
    await waitFor(() => expect(screen.queryByTestId('unsaved-work-dialog') !== null || settled !== null).toBe(true), { timeout: 5_000 })
    expect(settled).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await asked).toBe(false)
  }, 15_000)

  it('closing does not ask for an idle agent, a plain shell or a finished job', async () => {
    app([pane('p4', 'Claude', 'ws-front'), pane('p5', null, 'ws-front')], { p4: terminal({ agentState: 'idle' }), p5: terminal({ isWorking: true }) })
    jobs['ws-front'] = [{ id: 'j2', workspaceId: 'ws-front', label: 'Build', command: 'npm run build', status: 'exited' }]
    const { closing, first } = await close('c4')
    expect(first).toBe('proceed')
    await closing
  })
})
