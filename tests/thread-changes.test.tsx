import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ThreadEvent, ThreadSnapshot } from '../shared/types/thread'
import { changeSummary, threadChanges, turnChanges } from '../src/components/Threads/threadChanges'
import { parseThreadPatch, splitThreadPatch } from '../shared/threadPatch'
import { ThreadChangesPanel } from '../src/components/Threads/ThreadChangesPanel'
import { ThreadFileActivity } from '../src/components/Threads/ThreadFileActivity'

afterEach(cleanup)
const patch = '--- a/file.ts\n+++ b/file.ts\n@@ -8,2 +8,2 @@\n-old\n+new\n context\n'
function tool(id: string): ThreadEvent { return { type: 'tool', id, name: 'fileChange', state: 'completed', detail: 'file.ts', files: [{ path: '/repo/file.ts', kind: 'update', state: 'completed', source: 'native-patch', artifactId: id, additions: 1, deletions: 1 }] } }
const thread: ThreadSnapshot['thread'] = { id: 't', workspaceId: 'ws', projectId: 'p', rootPath: '/repo', provider: 'codex', nativeSessionId: null, title: 'Review', pinned: false, status: 'idle', createdAt: 1, updatedAt: 1 }
describe('transparent file changes', () => {
  it('counts hunk lines correctly, including removed content that starts with dashes', () => {
    expect(parseThreadPatch(patch)).toMatchObject({ additions: 1, deletions: 1, hunks: [{ lines: [{ oldLineNo: 8, newLineNo: null }, { oldLineNo: null, newLineNo: 8 }, { oldLineNo: 9, newLineNo: 9 }] }] })
    expect(parseThreadPatch('@@ -1 +1 @@\n----\n++++\n')).toMatchObject({ additions: 1, deletions: 1 })
    expect(parseThreadPatch('--- a\n+++ b')).toMatchObject({ additions: 0, deletions: 0, hunks: [] })
  })
  it('does not add repeated edits as net turn totals or treat tool inputs as verified patches', () => {
    expect(changeSummary(threadChanges([tool('one')]))).toMatchObject({ files: 1, exact: true, additions: 1 })
    expect(changeSummary(threadChanges([tool('one'), tool('two')]))).toMatchObject({ files: 1, operations: 2, exact: false, additions: undefined })
    const event = tool('input')
    if (event.type === 'tool') event.files![0].source = 'tool-input'
    expect(changeSummary(threadChanges([event])).exact).toBe(false)
    const aggregate = { type: 'turn-diff' as const, id: 'turn-diff:turn', turnId: 'turn', files: [{ path: 'file.ts', kind: 'update' as const, source: 'native-patch' as const, state: 'completed' as const, additions: 2, deletions: 1 }] }
    expect(changeSummary(turnChanges([tool('one'), tool('two'), aggregate]))).toMatchObject({ exact: true, files: 1, additions: 2, deletions: 1 })
    const observation: ThreadEvent = { type: 'turn-diff', id: 'verified-diff:turn', turnId: 'turn', files: [{ path: 'README.md', kind: 'update', source: 'working-tree-observation', state: 'completed' }] }
    expect(turnChanges([aggregate, observation]).map(entry => entry.file.path)).toEqual(['file.ts', 'README.md'])
  })
  it('explains why a file operation failed instead of showing only an ambiguous status', () => {
    const event = tool('failed')
    if (event.type === 'tool') {
      event.state = 'failed'
      event.output = 'Interrupted because OXESpace restarted before this operation completed.'
      event.files![0].state = 'failed'
    }
    render(<ThreadFileActivity event={event as Extract<ThreadEvent, { type: 'tool' }>} root="/repo" threadId="t" onOpen={() => {}} />)
    expect(screen.getByRole('alert')).toHaveTextContent('OXESpace restarted')
    expect(screen.getByText('Failed')).toBeVisible()
  })
  it('splits provider aggregate patches, retaining deletes, renames and binary file identities', () => {
    const result = splitThreadPatch('diff --git a/deleted.ts b/deleted.ts\n--- a/deleted.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n' + 'diff --git a/old.ts b/new.ts\nrename from old.ts\nrename to new.ts\n' + 'diff --git a/image.png b/image.png\nBinary files differ\n')
    expect(result.map(file => ({ path: file.path, kind: file.kind, previousPath: file.previousPath }))).toEqual([{ path: 'deleted.ts', kind: 'delete', previousPath: undefined }, { path: 'new.ts', kind: 'rename', previousPath: 'old.ts' }, { path: 'image.png', kind: 'update', previousPath: undefined }])
  })
  it('loads evidence within its Thread and adds a line comment without executing a prompt', async () => {
    const artifact = vi.fn(async () => ({ id: 'one', hash: 'revision', content: patch, bytes: patch.length, truncated: false, source: 'native-patch' })), onComment = vi.fn(), send = vi.fn()
    Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { artifact, send } } })
    render(<ThreadChangesPanel snapshot={{ thread, events: [tool('one')] }} panel="changes" onClose={() => {}} onComment={onComment} />)
    await screen.findByRole('region', { name: 'File diff' })
    expect(artifact).toHaveBeenCalledWith('t', 'one')
    fireEvent.click(screen.getByRole('button', { name: 'Comment on new line 8' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Review comment' }), { target: { value: 'Please rename this variable.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to conversation' }))
    expect(onComment).toHaveBeenCalledWith({ path: '/repo/file.ts', side: 'new', line: 8, content: 'new', body: 'Please rename this variable.', revision: 'revision' })
    expect(send).not.toHaveBeenCalled()
  })
  it('ignores a stale patch response after switching to another Thread', async () => {
    let resolveOld!: (value: unknown) => void
    const artifact = vi.fn(id => id === 't' ? new Promise(resolve => { resolveOld = resolve }) : Promise.resolve({ id: 'two', hash: 'two', content: 'second evidence', source: 'tool-input' }))
    Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { artifact } } })
    const props = { panel: 'changes' as const, onClose() {}, onComment() {} }
    const view = render(<ThreadChangesPanel {...props} snapshot={{ thread, events: [tool('one')] }} />)
    view.rerender(<ThreadChangesPanel {...props} snapshot={{ thread: { ...thread, id: 'second' }, events: [tool('two')] }} />)
    await screen.findByText('second evidence')
    resolveOld({ id: 'one', hash: 'one', content: 'stale first evidence', source: 'tool-input' })
    await waitFor(() => expect(screen.queryByText('stale first evidence')).not.toBeInTheDocument())
  })
  it('offers project files and search in the same Thread workbench', async () => {
    const user = userEvent.setup()
    Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { artifact: vi.fn(async () => ({ id: 'one', hash: 'revision', content: patch, bytes: patch.length, truncated: false, source: 'native-patch' })) } } })
    render(<ThreadChangesPanel snapshot={{ thread, events: [tool('one')] }} panel="changes" onClose={() => {}} onComment={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Select review panel' }))
    expect(await screen.findByRole('menuitemradio', { name: 'Files' })).toBeVisible()
    expect(screen.getByRole('menuitemradio', { name: 'Source control' })).toBeVisible()
    expect(screen.getByRole('menuitemradio', { name: 'Find in files' })).toBeVisible()
    expect(screen.getByRole('menuitemradio', { name: 'Scripts' })).toBeVisible()
    expect(screen.getByRole('menuitemradio', { name: 'Background activity' })).toBeVisible()
    expect(screen.getByRole('menuitemradio', { name: 'Web preview' })).toBeVisible()
    expect(screen.getByRole('menuitemradio', { name: 'Agents' })).toBeVisible()
  })
  it('renders native agent lifecycle with child IDs and status', () => {
    const event: ThreadEvent = { type: 'subagent', id: 'delegate', action: 'spawnAgent', state: 'completed', senderThreadId: 'native-A', receiverThreadIds: ['child-A'], agents: [{ threadId: 'child-A', status: 'completed', message: 'Audit complete' }], prompt: 'Audit authentication', model: 'gpt-5', reasoningEffort: 'high' }
    render(<ThreadChangesPanel snapshot={{ thread, events: [event] }} panel="agents" onClose={() => {}} onComment={() => {}} />)
    expect(screen.getByText('Started agent')).toBeVisible()
    expect(screen.getByText('child-A')).toBeVisible()
    expect(screen.getByText('Audit complete')).toBeVisible()
  })
})
