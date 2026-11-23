// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { crossWorkspaceReadApproval, type ActionScope, type WorkspaceLike } from '../../../electron/main/mcp-internal/domain-tool'
import type { ToolContext } from '../../../electron/main/mcp-internal/tool-registry'

// OXE-365 (HML3): a cross-workspace read named a pane the other workspace does not have and still opened the approval
// modal, whose text showed workspace and pane UUIDs to the person.

const A_ID = '0b9f3c1e-5d2a-4f8e-9c11-2a7d6e4b8f01'
const B_ID = '7c4e2a90-1b3d-4e6f-8a2c-9d0e1f2a3b4c'
const PANE_ID = 'e2d1c0b9-a8f7-4e6d-9c5b-4a3f2e1d0c9b'

function ctx(workspaces: WorkspaceLike[]): ToolContext {
  return { workspaceServ: { get: (id: string) => workspaces.find(ws => ws.id === id) ?? null, list: () => workspaces } } as unknown as ToolContext
}
const scope = { rootPath: '/repo-a', name: 'Projeto A', workspaceId: A_ID, actor: { key: 'k', label: 'agent' } } as unknown as ActionScope
const projectA: WorkspaceLike = { id: A_ID, name: 'Projeto A', rootPath: '/repo-a', panes: [{ id: 'a-1' }] }
const projectB: WorkspaceLike = { id: B_ID, name: 'Projeto B', rootPath: '/repo-b', panes: [{ id: PANE_ID, displayName: 'Codex B' }] }

describe('OXE-365 · cross-workspace read approval', () => {
  test('a pane the named workspace does not have is refused as not found, with no approval to show', () => {
    let refusal: unknown = null
    try {
      crossWorkspaceReadApproval({ workspaceId: B_ID }, scope, ctx([projectA, projectB]), { actionLabel: 'Read terminal output', paneId: 'no-such-pane' })
    } catch (error) { refusal = error }
    expect(refusal).toMatchObject({ code: 'not-found' })
  })

  test('the text and target the person reads name the workspaces and the pane, never their ids', () => {
    const approval = crossWorkspaceReadApproval({ workspaceId: B_ID }, scope, ctx([projectA, projectB]), { actionLabel: 'Read terminal output', paneId: PANE_ID })!
    expect(approval.text).toBe('Read terminal output in workspace "Projeto B" (pane "Codex B") from workspace "Projeto A"')
    expect(approval.target).toBe('Projeto B')
    for (const id of [A_ID, B_ID, PANE_ID]) expect(`${approval.text} ${approval.target} ${approval.summary}`).not.toContain(id)
    // The session grant still binds the exact pair of workspaces.
    expect(approval.brokerScope).toContain(A_ID)
    expect(approval.brokerScope).toContain(B_ID)
  })

  test('a name two workspaces share also shows the target folder, so the person knows which one', () => {
    const twin: WorkspaceLike = { id: 'ws-twin', name: 'Projeto B', rootPath: '/other/b', panes: [] }
    const approval = crossWorkspaceReadApproval({ workspaceId: B_ID }, scope, ctx([projectA, projectB, twin]), { actionLabel: 'List agent panes' })!
    expect(approval.target).toBe('Projeto B (/repo-b)')
    expect(approval.text).toBe('List agent panes in workspace "Projeto B (/repo-b)" from workspace "Projeto A"')
  })
})
