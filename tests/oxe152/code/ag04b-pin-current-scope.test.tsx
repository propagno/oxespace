// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 (OXE program oxespace-152-code, phase F6, Jira OXE-183, AG-04b), the
// window part. Written by the planner; the executor must not edit it. Source: the card OXE-183 (CA-1, CA-2, RN-1, RT-2,
// RT-3: "Pinned to {{folder}}" / "Fixado em {{folder}}") from AG-04 item 2b, approved by MARCA as a behaviour change for
// 1.5.2 (the pin keeps the CURRENT scope); the user's decision of 15/11 ("Escopo manda").
// Today (main 66e0080d5) the pin is a boolean per workspace (ui.store › panelScopePinnedByWorkspace) that sends the panels
// back to the workspace root, so pinning while reading a worktree leaves it.
// Contract:
// - useUIStore.panelScopePinnedByWorkspace[workspaceId] is the pinned path (string) or absent (following the active pane);
//   togglePanelScopePin(workspaceId, rootPath) pins that path, or unpins when already pinned. The badge passes the scope
//   it shows (scope.rootPath).
// - resolveWorkspaceScope(workspace, activePaneId, pinned) takes the pinned path: with a path, the scope is that path
//   (pinned true, isWorktree when it is not the workspace root), whatever pane is active; null follows the active pane as
//   today. (true, the legacy value, reads as the workspace root: A38.)
// - The pinned badge's title is code:workspace.scope.pinned with {{folder}} the pinned folder's name: en "Pinned to
//   {{folder}}", pt-BR "Fixado em {{folder}}".
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PanelScopeBadge } from '../../../src/components/Workspace/PanelScopeBadge'
import { useUIStore } from '../../../src/store/ui.store'
import { resolveWorkspaceScope } from '../../../src/utils/workspaceScope'
import { changeLanguage } from '../../../src/i18n'
import type { Workspace } from '../../../shared/types/workspace'

vi.mock('../../../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: 'hotfix/pix', detached: false, shortSha: null, error: null }) }))

const workspace = { rootPath: '/repo', panes: [{ id: 'root-pane', rootPath: null }, { id: 'wt-pane', rootPath: '/repo-wt/hotfix-pix' }] } as unknown as Pick<Workspace, 'rootPath' | 'panes'>
const resolve = resolveWorkspaceScope as unknown as (ws: typeof workspace, pane: string | null, pinned: string | boolean | null) => { rootPath: string; isWorktree: boolean; pinned: boolean }
const badge = (): HTMLElement => screen.getByTestId('panel-scope-badge')

beforeEach(() => { localStorage.clear(); useUIStore.setState({ panelScopePinnedByWorkspace: {} } as never) })
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await changeLanguage('en') })

describe('OXE-183 AG-04b the pin keeps the current scope (A36)', () => {
  it.each([['en', 'Pinned to hotfix-pix'], ['pt-BR', 'Fixado em hotfix-pix']])('pinning while reading a worktree (%s) keeps that worktree, and says so', async (locale, title) => {
    await changeLanguage(locale)
    const scope = resolve(workspace, 'wt-pane', null)
    expect(scope.rootPath).toBe('/repo-wt/hotfix-pix')
    render(<PanelScopeBadge workspaceId="ws" scope={scope as never} />)
    await userEvent.click(badge())
    expect(useUIStore.getState().panelScopePinnedByWorkspace.ws as unknown).toBe('/repo-wt/hotfix-pix')
    cleanup()
    render(<PanelScopeBadge workspaceId="ws" scope={resolve(workspace, 'wt-pane', '/repo-wt/hotfix-pix') as never} />)
    expect(badge()).toHaveAttribute('title', title)
  })

  it('pinned, another active pane does not move the panels; unpinning follows the active pane again', () => {
    useUIStore.getState().togglePanelScopePin('ws', '/repo-wt/hotfix-pix' as never)
    const pinned = useUIStore.getState().panelScopePinnedByWorkspace.ws as unknown as string
    expect(pinned).toBe('/repo-wt/hotfix-pix')
    expect(resolve(workspace, 'root-pane', pinned)).toMatchObject({ rootPath: '/repo-wt/hotfix-pix', pinned: true, isWorktree: true })
    useUIStore.getState().togglePanelScopePin('ws', '/repo-wt/hotfix-pix' as never)
    const after = (useUIStore.getState().panelScopePinnedByWorkspace.ws as unknown as string | undefined) ?? null
    expect(after).toBeNull()
    expect(resolve(workspace, 'root-pane', after)).toMatchObject({ rootPath: '/repo', pinned: false, isWorktree: false })
    expect(resolve(workspace, 'wt-pane', after)).toMatchObject({ rootPath: '/repo-wt/hotfix-pix', pinned: false, isWorktree: true })
  })
})
