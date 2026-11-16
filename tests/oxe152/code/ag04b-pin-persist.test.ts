// Frozen acceptance test for 1.5.2 OxeCode/Shell F6 (OXE program oxespace-152-code, phase F6, Jira OXE-183, AG-04b), the
// backend part: the pinned path per workspace persists across restarts, and a legacy boolean reads as before. Written by
// the planner; the executor must not edit it. Source: the card OXE-183 (CA-3, CA-4, RN-2, RT-2) and the user's rule of
// 15/11 ("o backend deve acompanhar").
// Today (main 66e0080d5) the pin is "deliberately not persisted" (src/store/ui.store.ts › panelScopePinnedByWorkspace).
// Contract: the pinned paths live in localStorage under "oxe.panel-scope-pins" as JSON { [workspaceId]: path }; the ui
// store reads it when it is created (a restart is a fresh import of the module) and writes it on every pin and unpin. A
// saved legacy value true reads as the workspace root (resolveWorkspaceScope with true → the root, pinned), false or a
// missing entry as following the active pane; a broken value is ignored (no throw).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = 'oxe.panel-scope-pins'
type Store = typeof import('../../../src/store/ui.store')
type Scope = typeof import('../../../src/utils/workspaceScope')
async function restart(): Promise<{ store: Store['useUIStore']; resolve: (ws: unknown, pane: string | null, pinned: unknown) => { rootPath: string; pinned: boolean } }> {
  vi.resetModules()
  const { useUIStore } = await import('../../../src/store/ui.store') as Store
  const { resolveWorkspaceScope } = await import('../../../src/utils/workspaceScope') as Scope
  return { store: useUIStore, resolve: resolveWorkspaceScope as never }
}
const workspace = { rootPath: '/repo', panes: [{ id: 'root-pane', rootPath: null }, { id: 'wt-pane', rootPath: '/repo-wt/hotfix-pix' }] }
const pinnedOf = (store: Store['useUIStore'], id: string): unknown => (store.getState().panelScopePinnedByWorkspace as Record<string, unknown>)[id]

beforeEach(() => { localStorage.clear() })
afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('OXE-183 AG-04b the pinned path survives a restart (A38)', () => {
  it('a pinned path is saved and comes back after a restart; unpinning removes it', async () => {
    const first = await restart()
    first.store.getState().togglePanelScopePin('ws', '/repo-wt/hotfix-pix' as never)
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toEqual({ ws: '/repo-wt/hotfix-pix' })
    const second = await restart()
    expect(pinnedOf(second.store, 'ws')).toBe('/repo-wt/hotfix-pix')
    expect(second.resolve(workspace, 'root-pane', pinnedOf(second.store, 'ws'))).toMatchObject({ rootPath: '/repo-wt/hotfix-pix', pinned: true })
    second.store.getState().togglePanelScopePin('ws', '/repo-wt/hotfix-pix' as never)
    const third = await restart()
    expect(pinnedOf(third.store, 'ws') ?? null).toBeNull()
  })

  it('a legacy true reads as the workspace root; false follows the active pane; a broken value is ignored', async () => {
    localStorage.setItem(KEY, JSON.stringify({ legacy: true, off: false }))
    const { store, resolve } = await restart()
    expect(resolve(workspace, 'wt-pane', pinnedOf(store, 'legacy') ?? null)).toMatchObject({ rootPath: '/repo', pinned: true })
    expect(resolve(workspace, 'wt-pane', pinnedOf(store, 'off') ?? null)).toMatchObject({ rootPath: '/repo-wt/hotfix-pix', pinned: false })
    localStorage.setItem(KEY, '{not json')
    const broken = await restart()
    expect(broken.store.getState().panelScopePinnedByWorkspace).toEqual({})
  })
})
