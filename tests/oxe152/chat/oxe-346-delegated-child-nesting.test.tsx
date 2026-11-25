import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase } from '../../../electron/main/db'
import { ExecutionRegistry } from '../../../electron/main/services/execution-registry'
import { findTool, type ToolContext } from '../../../electron/main/mcp-internal/tool-registry'
import { ThreadHistory } from '../../../electron/main/services/conversation/thread-history'
import { ThreadSidebar } from '../../../src/components/Threads/ThreadSidebar'
import { resetSectionsForTests } from '../../../src/components/Threads/sections/sectionsApi'
import { useNavigationPrefs } from '../../../src/store/navigation-prefs.store'
import { useThreadStore } from '../../../src/store/thread.store'
import { useUIStore } from '../../../src/store/ui.store'
import type { ConversationThread, ThreadApi, ThreadProjectSummary, ThreadSnapshot } from '../../../shared/types/thread'

/**
 * OXE-346 · Delegated child conversations created via oxespace_thread_create (mcp_thread_handoffs)
 * expose their originating parent from main SQLite, nest under their parent in ThreadSidebar with
 * OXE-170's one-line child row inside a sibling role="group" (matching S3's childOf locator), and
 * follow their parent's section across restarts.
 */
function childGroupOf(container: HTMLElement, parentTitle: string): HTMLElement {
  const item = [...container.querySelectorAll<HTMLElement>('[role="treeitem"], .thread-navigation-item')]
    .find(node => node.textContent?.includes(parentTitle))
  expect(item, `item for "${parentTitle}"`).toBeTruthy()
  // Mirrors S3-conversations-survive-restart.spec.ts's exact childOf XPath: following-sibling::*[1] | descendant::*[@role="group"]
  // (in XPath document order, descendants precede following-siblings).
  const evaluated = typeof document.evaluate === 'function'
    ? (document.evaluate('following-sibling::*[1] | descendant::*[@role="group"]', item!, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue as HTMLElement | null)
    : (item!.querySelector<HTMLElement>('[role="group"]') ?? (item!.nextElementSibling as HTMLElement | null))
  expect(evaluated, `nested group for "${parentTitle}"`).toBeTruthy()
  return evaluated!
}

describe('OXE-346 · delegated child conversation nesting from mcp_thread_handoffs', () => {
  beforeEach(() => {
    localStorage.clear()
    resetSectionsForTests()
    useNavigationPrefs.setState({ width: 280, expanded: {}, stateFilter: { code: 'all', thread: 'all' } })
    useUIStore.setState({ collapsedSidebars: { ...useUIStore.getState().collapsedSidebars, thread: false } })
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('exposes parentThreadId from mcp_thread_handoffs in main and nests the child under its parent in ThreadSidebar', async () => {
    const db = openInMemoryDatabase()
    try {
      const root = process.cwd(), now = Date.now(), projectId = 'p1'
      db.prepare('INSERT INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(projectId, root, root, 'Atlas', now, now)
      db.prepare('INSERT INTO thread_project_contexts (project_id, root_path) VALUES (?, ?)').run(projectId, root)

      const insertThread = (title: string, createdAt: number): ConversationThread => {
        const thread: ConversationThread = {
          id: randomUUID(), workspaceId: `thread:${projectId}`, projectId, rootPath: root, provider: 'claude',
          nativeSessionId: null, title, pinned: false, status: 'idle', createdAt, updatedAt: createdAt, generation: 1
        }
        db.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES (?, ?, ?, ?, ?)')
          .run(thread.id, thread.workspaceId, thread.projectId, JSON.stringify(thread), '[]')
        return thread
      }

      const parent = insertThread('Parent plan', now - 2000)
      const sibling = insertThread('Standalone note', now - 1000)

      // Create delegated child through the real oxespace_thread_create MCP tool (writes mcp_thread_handoffs only, never data_json.parentThreadId).
      const snapshots = new Map<string, ThreadSnapshot>([[parent.id, { thread: parent, events: [] }]])
      const manager = {
        read: (id: string) => snapshots.get(id)!,
        create: (context: Pick<ConversationThread, 'workspaceId' | 'projectId' | 'rootPath' | 'provider'>) => {
          const thread: ConversationThread = {
            ...context, id: randomUUID(), nativeSessionId: null, title: 'Child spike', pinned: false, status: 'idle',
            createdAt: now - 1500, updatedAt: now - 1500, generation: 1
          }
          db.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES (?, ?, ?, ?, ?)')
            .run(thread.id, thread.workspaceId, thread.projectId, JSON.stringify(thread), '[]')
          const snap = { thread, events: [] }
          snapshots.set(thread.id, snap)
          return snap
        },
        send: vi.fn(async () => undefined)
      }
      const executions = new ExecutionRegistry()
      const env = executions.register({ owner: { kind: 'thread', id: parent.id }, workspaceId: parent.workspaceId, cwd: root })
      const ctx = {
        db, threads: Promise.resolve(manager), executions, workspaceId: parent.workspaceId,
        executionId: env.OXESPACE_EXECUTION_ID, executionToken: env.OXESPACE_EXECUTION_TOKEN
      } as unknown as ToolContext
      const created = JSON.parse((await findTool('oxespace_thread_create')!.handler({ key: 'delegate-spike-1' }, ctx)).content[0].text!) as { threadId: string }

      // Confirm data_json itself has NO parentThreadId — mcp_thread_handoffs is the durable SQLite source of truth.
      const rawJson = (db.prepare('SELECT data_json FROM conversation_threads WHERE id = ?').get(created.threadId) as { data_json: string }).data_json
      expect(JSON.parse(rawJson).parentThreadId).toBeUndefined()

      // Simulate restart: a fresh ThreadHistory instance reads from SQLite.
      const historyAfterRestart = new ThreadHistory(db)
      const listed = historyAfterRestart.listThreads()
      const listedChild = listed.find(item => item.id === created.threadId)!
      expect(listedChild.parentThreadId).toBe(parent.id)
      const windowRead = historyAfterRestart.readWindow(created.threadId)
      expect(windowRead.thread.parentThreadId).toBe(parent.id)
      const deltaRead = historyAfterRestart.readSince(created.threadId, windowRead.sync!)
      expect(deltaRead.ok && deltaRead.thread.parentThreadId).toBe(parent.id)

      // Mount ThreadSidebar with the restarted main list and section assignment on the parent only.
      const projectSummary: ThreadProjectSummary = { projectId, displayName: 'Atlas', identityLabel: root, hidden: false, contexts: [{ rootPath: root, label: 'Atlas' }] }
      const sectionState = { sections: [{ id: 'sec-rev', name: 'Reviews', order: 0, collapsed: false }], assignments: { [parent.id]: 'sec-rev' } }
      const api = {
        list: vi.fn(async () => listed),
        projects: vi.fn(async () => ({ projects: [projectSummary], unavailable: [] })),
        read: vi.fn(async (id: string) => ({ thread: listed.find(item => item.id === id)!, events: [] })),
        command: vi.fn(async () => undefined),
        onChanged: vi.fn(() => () => {}),
        sections: vi.fn(async () => sectionState),
        saveSections: vi.fn(async (_w: string, state: unknown) => ({ ok: true, state })),
        pendingRequestsAll: vi.fn(async () => []),
        respondPending: vi.fn(async () => ({ ok: true })),
        sessions: vi.fn(async () => []),
        onPlacesChanged: vi.fn(() => () => {})
      }
      Object.defineProperty(window, 'oxe', { configurable: true, value: { app: { platform: 'win32' }, thread: api as unknown as ThreadApi } })
      useThreadStore.setState({
        threads: listed, projects: [projectSummary], unavailableProjects: [], loading: false, listLoaded: true,
        selectedId: sibling.id, secondaryId: null, snapshot: null, snapshotCache: {}, snapshotCacheOrder: [],
        errors: {}, hiddenProjects: [], expanded: { [projectId]: true }, unreadIds: []
      } as never)

      const { container } = render(<ThreadSidebar onCreate={vi.fn()} onCreateParallel={vi.fn()} />)
      await waitFor(() => expect(screen.getByRole('region', { name: 'Reviews' })).toBeInTheDocument())

      // 1. Child spike is nested right under Parent plan in a sibling role="group" (S3's childOf contract).
      const group = childGroupOf(container, 'Parent plan')
      expect(group).toHaveAttribute('role', 'group')
      expect(within(group).getByText('Child spike')).toBeInTheDocument()

      // 2. Child spike renders once, as a one-line child row, and never duplicated as a top-level conversation.
      const allRows = [...container.querySelectorAll<HTMLElement>('[data-ui="sidebar-row"]')]
      const childRows = allRows.filter(node => node.textContent?.includes('Child spike'))
      expect(childRows).toHaveLength(1)
      expect(childRows[0]).toHaveAttribute('data-lines', '1')
      expect(childRows[0].closest('[data-thread-row]')).toHaveAttribute('data-parent-thread', parent.id)

      // 2b. [data-thread-row="<parentId>"] contains ONLY the parent's single [data-ui="sidebar-row"] (e2e/oxechat-late-request.spec.ts).
      const parentThreadRow = container.querySelector<HTMLElement>(`[data-thread-row="${parent.id}"]`)!
      expect(parentThreadRow).toBeTruthy()
      const parentSidebarRows = parentThreadRow.querySelectorAll<HTMLElement>('[data-ui="sidebar-row"]')
      expect(parentSidebarRows).toHaveLength(1)
      expect(parentSidebarRows[0]).toHaveTextContent('Parent plan')
      expect(parentSidebarRows[0]).not.toHaveTextContent('Child spike')

      // 2c. Row actions sit AFTER [data-ui="sidebar-row"] (matching NavigationChrome.css [role='button'] + span stacking)
      //     and stay above the row so "Actions for <title>" is clickable and opens the conversation menu.
      const actionsButton = within(parentThreadRow).getByRole('button', { name: 'Actions for Parent plan' })
      expect(parentSidebarRows[0].compareDocumentPosition(actionsButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      const sidebarCss = readFileSync(join(process.cwd(), 'src/components/Threads/ThreadSidebar.module.css'), 'utf8')
      expect(sidebarCss).not.toMatch(/\.actions\s*\{[^}]*z-index:\s*var\(--layer-raised\)\s*;/)
      fireEvent.click(actionsButton)
      expect(await screen.findByRole('menuitem', { name: 'Rename conversation…' })).toBeInTheDocument()
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

      // 3. Follows parent's section ("Reviews"): both Parent plan and Child spike sit inside Reviews.
      const reviews = screen.getByRole('region', { name: 'Reviews' })
      expect(within(reviews).getByText('Parent plan')).toBeInTheDocument()
      expect(within(reviews).getByText('Child spike')).toBeInTheDocument()
      expect(within(reviews).queryByText('Standalone note')).toBeNull()

      // 4. Reload / remount with fresh store + sections cache still preserves nesting and section.
      cleanup()
      resetSectionsForTests()
      const reloaded = new ThreadHistory(db).listThreads()
      useThreadStore.setState({ threads: reloaded, projects: [projectSummary], listLoaded: true } as never)
      const second = render(<ThreadSidebar onCreate={vi.fn()} onCreateParallel={vi.fn()} />)
      await waitFor(() => expect(within(screen.getByRole('region', { name: 'Reviews' })).getByText('Child spike')).toBeInTheDocument())
      expect(within(childGroupOf(second.container, 'Parent plan')).getByText('Child spike')).toBeInTheDocument()
    } finally {
      db.close()
    }
  })
})
