import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInChanges, resolveRequestedRef, useChangesRequestStore } from '../../src/store/changes-request.store'
import { useWorkspaceStore } from '../../src/store/workspace.store'

afterEach(() => { useChangesRequestStore.setState({ byWorkspace: {} }); vi.restoreAllMocks() })

describe('opening a comparison from another panel', () => {
  it('prefers a local branch, then the remote one of the same name, else keeps the name', () => {
    expect(resolveRequestedRef('main', ['main', 'origin/main'])).toBe('main')
    expect(resolveRequestedRef('feature/x', ['main', 'origin/feature/x'])).toBe('origin/feature/x')
    // `origin/feature/x` must not satisfy a request for `x`.
    expect(resolveRequestedRef('x', ['origin/feature/x'])).toBe('x')
    expect(resolveRequestedRef('gone', ['main'])).toBe('gone')
  })

  it('records the request for the workspace and shows its Changes panel', () => {
    const update = vi.spyOn(useWorkspaceStore.getState(), 'updateReviewState').mockResolvedValue(undefined)
    openInChanges('ws', { base: 'main', head: 'feature' })
    expect(useChangesRequestStore.getState().byWorkspace.ws).toMatchObject({ base: 'main', head: 'feature' })
    expect(update).toHaveBeenCalledWith({ workspaceId: 'ws', reviewPanelVisible: true })
    useChangesRequestStore.getState().clear('ws')
    expect(useChangesRequestStore.getState().byWorkspace.ws).toBeUndefined()
  })
})
