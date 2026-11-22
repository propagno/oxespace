// Frozen acceptance test for 1.5.2 HML fixes (Jira OXE-332, HML P0 on 07d8df07c). Written by the planner; the executor
// must not edit it. The bug: "See impact" in the needs-you queue does nothing when the conversation is not in the
// thread store's cache, and from OxeCode an inline card never switches to OxeChat; the popover stays open.
// Contract:
// - src/components/Approvals/openRequest.ts: useOpenRequest gains `threadId: string | null`; `open(id, threadId?)`
//   keeps `open(id)` working (u75) and records the conversation the request belongs to; `close()` clears both.
// - src/components/Navigation/NeedsYouQueue.tsx: See impact calls open(requestId, row.id) and closes the popover with
//   onClose(false) (the person went somewhere else).
// - src/components/Approvals/ApprovalsHost.tsx: an opened request not found in snapshot/snapshotCache, with a threadId,
//   loads that conversation (useThreadStore.select(threadId), which reads window.oxe.thread.read) and then shows it.
//   When the request is answered inline (not an irreversible impact preview), the window goes to OxeChat:
//   ApprovalsHost dispatches window CustomEvent 'oxe:open-thread' with detail { threadId }.
// - src/app/openThread.ts (new): useOpenThreadListener(selectMode) listens to 'oxe:open-thread' and selects the
//   'thread' view (selectMode('thread')) and that conversation (useThreadStore.select(threadId)), as App does for
//   'oxe:open-pane'; src/App.tsx calls it with its selectMode (App.tsx is at its size limit, so the listener lives here).
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { AgentRow } from '../../../shared/types/agents'
import { ApprovalsHost } from '../../../src/components/Approvals/ApprovalsHost'
import { useOpenRequest } from '../../../src/components/Approvals/openRequest'
import { NeedsYouQueue } from '../../../src/components/Navigation/NeedsYouQueue'
import { useThreadStore } from '../../../src/store/thread.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'

const catalog = JSON.parse(readFileSync(join(process.cwd(), 'shared/locales/en/thread.json'), 'utf8')) as { f7: { card: { seeImpact: string } } }
type OpenState = { requestId: string | null; threadId?: string | null; open(id: string, threadId?: string): void; close(): void }
/** The new module, loaded at run time so the other cases still run (and fail on their own contract) before T1 creates it. */
async function loadOpenThread(): Promise<{ useOpenThreadListener(selectMode: (view: 'thread' | 'code' | 'data') => void): void }> {
  const file = ['.ts', '.tsx'].map(ext => join(process.cwd(), 'src/app/openThread' + ext)).find(candidate => existsSync(candidate))
  if (!file) throw new Error('src/app/openThread.ts does not exist yet')
  return import(/* @vite-ignore */ pathToFileURL(file).href)
}
const openState = (): OpenState => useOpenRequest.getState() as unknown as OpenState

const criticalRow = (): AgentRow => ({
  kind: 'thread', id: 'thread-1', state: 'needs-you', provider: 'claude', mode: 'thread', title: 'Auth', workspaceId: 'ws-1',
  since: 1, seenAt: null, session: null, worktree: null, cost: null,
  requests: [{ requestId: 'r1', kind: 'approval', title: { code: 'agents.request.approval', params: {} }, risk: 'critical', reversible: false, answerable: true, since: 1, command: { text: 'rm -rf build', untrusted: true } }]
}) as unknown as AgentRow

const snapshotWith = (reversible: boolean) => ({
  thread: { id: 'thread-1', workspaceId: 'thread:p1', projectId: 'p1', rootPath: 'C:/dev/shop', provider: 'claude', nativeSessionId: null, title: 'Checkout fix', pinned: false, status: 'approval', createdAt: 1, updatedAt: 1 },
  events: [{ type: 'request', id: 'r1', request: {
    id: 'r1', nativeId: 'n1', nativeMethod: 'item/commandExecution/requestApproval', kind: 'approval', title: 'Run npm test', command: 'npm test',
    generation: 1, createdAt: 1, state: 'pending',
    impact: { where: 'C:/dev/shop', affects: { count: null, unit: 'files' }, reversible, risk: 'low', kind: 'command', text: 'npm test', lang: 'shell' }
  } }]
})

afterEach(() => {
  cleanup()
  act(() => { useOpenRequest.getState().close() })
  useThreadStore.setState({ snapshot: null, snapshotCache: {}, snapshotCacheOrder: [], selectedId: null, secondaryId: null } as never)
  vi.restoreAllMocks()
})

describe('OXE-332 · See impact works from OxeCode and without the conversation in cache', () => {
  test('See impact in the needs-you queue opens the request with its conversation and closes the popover', async () => {
    useWorkspaceStore.setState({ workspaces: [] } as never)
    Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { respond: vi.fn() } } })
    const onClose = vi.fn()
    const anchor = createRef<HTMLElement>()
    render(<><span ref={anchor as never} /><NeedsYouQueue agents={[criticalRow()]} anchor={anchor} onClose={onClose} /></>)
    await userEvent.click(screen.getByRole('button', { name: catalog.f7.card.seeImpact }))
    expect(openState().requestId).toBe('r1')
    expect(openState().threadId).toBe('thread-1')
    expect(onClose).toHaveBeenCalledWith(false)
    act(() => { openState().close() })
    expect(openState().threadId ?? null).toBeNull()
  })

  test('a request whose conversation is not cached loads it, selects it and takes the window to OxeChat', async () => {
    const read = vi.fn(async () => snapshotWith(true))
    Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { read }, approvals: {} } })
    useThreadStore.setState({ snapshot: null, snapshotCache: {}, snapshotCacheOrder: [], selectedId: null, secondaryId: null } as never)
    const opened: string[] = []
    const listen = (event: Event): void => { opened.push((event as CustomEvent<{ threadId: string }>).detail.threadId) }
    window.addEventListener('oxe:open-thread', listen)
    try {
      render(<ApprovalsHost />)
      act(() => { openState().open('r1', 'thread-1') })
      await waitFor(() => expect(read).toHaveBeenCalledWith('thread-1'))
      await waitFor(() => expect(useThreadStore.getState().selectedId).toBe('thread-1'))
      await waitFor(() => expect(opened).toContain('thread-1'))
    } finally { window.removeEventListener('oxe:open-thread', listen) }
  })

  test('the app switches to OxeChat on oxe:open-thread, as it does to OxeCode on oxe:open-pane', async () => {
    const select = vi.fn(async () => undefined)
    useThreadStore.setState({ select } as never)
    const { useOpenThreadListener } = await loadOpenThread()
    const selectMode = vi.fn()
    const hook = renderHook(() => useOpenThreadListener(selectMode))
    act(() => { window.dispatchEvent(new CustomEvent('oxe:open-thread', { detail: { threadId: 'thread-1' } })) })
    expect(selectMode).toHaveBeenCalledWith('thread')
    await waitFor(() => expect(select).toHaveBeenCalledWith('thread-1'))
    hook.unmount()
    selectMode.mockClear()
    act(() => { window.dispatchEvent(new CustomEvent('oxe:open-thread', { detail: { threadId: 'thread-2' } })) })
    expect(selectMode, 'the listener goes with the hook').not.toHaveBeenCalled()
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8')
    expect(app, 'App.tsx wires it with its selectMode').toMatch(/useOpenThreadListener\(\s*selectMode\s*\)/)
  })
})
