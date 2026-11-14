// Frozen acceptance test for 1.5.2 OxeChat (OXE program oxespace-152-chat, phase F1, Jira OXE-58). Written by the
// planner; the executor must not edit it. Spec: .oxe/alm/specs/OXE-58.md (CA-2, CA-3) and the 14/11 diagnosis.
//
// Contract (T1, the cold sidebar):
// - New module src/store/threadListCache.ts (no imports beyond types; never throws). Exports:
//   THREAD_LIST_CACHE_KEY = 'oxe.thread-list.v1', THREAD_LIST_CACHE_MAX_ROWS = 100, THREAD_LIST_CACHE_MAX_BYTES = 32768
//   (length of the stored JSON string);
//   readThreadListCache(storage = localStorage): { v: 1; savedAt: number; threads: CachedThreadRow[]; projects:
//   { projectId; displayName }[] } | null — null when the value is missing, not JSON, of another version or shape, over
//   MAX_BYTES, or the storage throws;
//   writeThreadListCache(threads, projects, storage = localStorage): void — leaves out archived conversations and those
//   of hidden projects, keeps the MAX_ROWS most recently updated, newest first, trims rows until the string fits
//   MAX_BYTES, writes only id, projectId, title, provider, status, pinned, createdAt, updatedAt (never paths, workspace
//   or session ids), under THREAD_LIST_CACHE_KEY only; a throwing setItem is swallowed;
//   clearThreadListCache(storage = localStorage): void — removes that key only.
// - src/store/thread.store.ts gains `listLoaded: boolean` (false at start; true once the first load() settles, ok or
//   failed). It writes the cache after a load and after loadProjects once listLoaded is true, and whenever a
//   conversation leaves the list: archiving or deleting it, or removing its project, drops its row from the cache at
//   once. The cache is never copied into `threads`/`projects` and never read when a module loads (boot neutral, OXE-105).
// - src/components/Threads/ThreadSidebar.tsx reads the cache once per mount while !listLoaded. With a cache, the first
//   commit shows its rows (same row markup, under the cached project names) and the aside carries
//   data-list-source="cache"; without one, the aside has aria-busy="true" and the list shows
//   [data-testid="thread-sidebar-skeleton"] holding the existing Skeleton ([data-skeleton]), announced as a status with
//   the existing thread:sidebar.loading words — never the EmptyState ("Add a project…") nor the LoadingState text. Once
//   the live list is in, the aside carries data-list-source="live". The header and search show in every state.
// - Clear data: the app has no clear-data action today (no clearStorageData or reset path in src/ or electron/ at
//   f77f38f43); a profile reset removes the profile folder and its Local Storage with it, which is where the cache lives,
//   under its one key. Any clear-data action added later must call clearThreadListCache. No source assertion is used.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThreadSidebar } from '../../../src/components/Threads/ThreadSidebar'
import { resetSectionsForTests } from '../../../src/components/Threads/sections/sectionsApi'
import { useThreadStore } from '../../../src/store/thread.store'
import type { ConversationThread, ThreadApi, ThreadProjectSummary } from '../../../shared/types/thread'

const KEY = 'oxe.thread-list.v1'
const ALLOWED_ROW_KEYS = ['id', 'projectId', 'title', 'provider', 'status', 'pinned', 'createdAt', 'updatedAt']
type CachedList = { v: 1; savedAt: number; threads: Array<Record<string, unknown>>; projects: Array<Record<string, unknown>> }
type CacheModule = {
  THREAD_LIST_CACHE_KEY: string; THREAD_LIST_CACHE_MAX_ROWS: number; THREAD_LIST_CACHE_MAX_BYTES: number
  readThreadListCache: (storage?: Storage) => CachedList | null
  writeThreadListCache: (threads: ConversationThread[], projects: ThreadProjectSummary[], storage?: Storage) => void
  clearThreadListCache: (storage?: Storage) => void
}
async function cacheModule(): Promise<CacheModule> {
  const file = ['.ts', '.tsx'].map(ext => join(process.cwd(), `src/store/threadListCache${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error('src/store/threadListCache.ts does not exist yet')
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<CacheModule>
}

const SECRET_ROOT = 'C:/secret-root/atlas'
const project = (projectId: string, displayName: string, hidden = false): ThreadProjectSummary =>
  ({ projectId, displayName, identityLabel: `${SECRET_ROOT}/${projectId}`, hidden, contexts: [{ rootPath: `${SECRET_ROOT}/${projectId}`, label: displayName }] })
const conversation = (id: string, title: string, updatedAt: number, extra: Partial<ConversationThread> = {}): ConversationThread => ({
  id, workspaceId: `ws-secret-${id}`, projectId: 'p1', rootPath: `${SECRET_ROOT}/p1`, provider: 'claude', title, pinned: false, status: 'idle',
  nativeSessionId: `session-secret-${id}`, createdAt: updatedAt, updatedAt, ...extra
} as ConversationThread)
/** A cache as the contract stores it, written straight to storage so the sidebar cases do not depend on the writer. */
const cachedValue = (threads: Array<{ id: string; title: string; projectId?: string; updatedAt?: number }>, projects = [{ projectId: 'p1', displayName: 'Atlas' }], v = 1) =>
  JSON.stringify({ v, savedAt: Date.now(), projects, threads: threads.map((row, index) => ({ id: row.id, projectId: row.projectId ?? 'p1', title: row.title, provider: 'claude', status: 'idle', pinned: false, createdAt: row.updatedAt ?? 100 - index, updatedAt: row.updatedAt ?? 100 - index })) })

const pending = <T,>() => new Promise<T>(() => {})
let api: Record<string, ReturnType<typeof vi.fn>>
function mockMain(overrides: Record<string, (...args: never[]) => unknown> = {}) {
  api = {
    list: vi.fn(() => pending<ConversationThread[]>()),
    projects: vi.fn(() => pending<{ projects: ThreadProjectSummary[]; unavailable: string[] }>()),
    read: vi.fn(async (id: string) => ({ thread: conversation(id, id, 1), events: [] })),
    command: vi.fn(async () => undefined),
    setProjectHidden: vi.fn(async () => undefined),
    onChanged: vi.fn(() => () => {}),
    sections: vi.fn(async () => ({ sections: [], assignments: {} })),
    saveSections: vi.fn()
  }
  for (const [name, impl] of Object.entries(overrides)) api[name] = vi.fn(impl)
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: api as unknown as ThreadApi } })
}
function resetStore() {
  useThreadStore.setState({ threads: [], projects: [], unavailableProjects: [], loading: false, listLoaded: false, selectedId: null, secondaryId: null, snapshot: null,
    snapshotCache: {}, snapshotCacheOrder: [], errors: {}, hiddenProjects: [], expanded: {}, unreadIds: [] } as never)
}
const aside = () => document.querySelector('aside.thread-navigation') as HTMLElement
const titles = (root: ParentNode = document) => [...root.querySelectorAll('.thread-session-title')].map(node => node.textContent)
const skeleton = () => screen.queryByTestId('thread-sidebar-skeleton')
const cachedIds = (cache: CachedList | null) => cache?.threads.map(row => row.id)
/** The App's cold start: the list and the projects are asked for after the sidebar's first commit. */
async function loadLive() {
  await act(async () => { await useThreadStore.getState().load(); await useThreadStore.getState().loadProjects() })
}

beforeEach(() => { localStorage.clear(); resetSectionsForTests(); mockMain(); resetStore() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('T1 · first paint with a cached list (CA-2)', () => {
  it('shows the cached conversations on the first commit, marked as from the cache, while the live list is still loading', () => {
    localStorage.setItem(KEY, cachedValue([{ id: 'a', title: 'Fix the login bug' }, { id: 'b', title: 'Write the release notes' }]))
    render(<ThreadSidebar onCreate={vi.fn()} />)
    expect(aside()).toHaveAttribute('data-list-source', 'cache')
    expect(titles()).toEqual(expect.arrayContaining(['Fix the login bug', 'Write the release notes']))
    expect(skeleton()).toBeNull()
    expect(screen.queryByText('Add a project to start a conversation.')).toBeNull()
    // The App starts the load after the first commit; the cache stays up, without a spinner, while it is pending.
    act(() => { void useThreadStore.getState().load() })
    expect(api.list).toHaveBeenCalled()
    expect(aside()).toHaveAttribute('data-list-source', 'cache')
    expect(titles()).toEqual(expect.arrayContaining(['Fix the login bug', 'Write the release notes']))
    expect(screen.queryByText('Loading conversations…')).toBeNull()
    expect(screen.getByText('Conversations')).toBeInTheDocument()
  })

  it('puts the cached rows under their cached project heading', () => {
    localStorage.setItem(KEY, cachedValue([{ id: 'a', title: 'Fix the login bug', projectId: 'p1' }, { id: 'b', title: 'Tune the query', projectId: 'p2' }],
      [{ projectId: 'p1', displayName: 'Atlas' }, { projectId: 'p2', displayName: 'Borealis' }]))
    render(<ThreadSidebar onCreate={vi.fn()} />)
    const group = (name: string) => [...document.querySelectorAll('.thread-project-name')].find(node => node.textContent === name)?.closest('section') as HTMLElement
    expect(group('Atlas')).toBeTruthy()
    expect(group('Borealis')).toBeTruthy()
    expect(titles(group('Atlas'))).toEqual(['Fix the login bug'])
    expect(titles(group('Borealis'))).toEqual(['Tune the query'])
  })
})

describe('T1 · skeleton without a cache (CA-3)', () => {
  it('shows a busy skeleton under the header, never the empty state or the loading spinner', () => {
    render(<ThreadSidebar onCreate={vi.fn()} />)
    act(() => { void useThreadStore.getState().load() })
    expect(aside()).toHaveAttribute('aria-busy', 'true')
    expect(aside()).not.toHaveAttribute('data-list-source', 'cache')
    const block = screen.getByTestId('thread-sidebar-skeleton')
    expect(block.querySelector('[data-skeleton]')).not.toBeNull()
    expect(document.querySelector('nav.thread-project-list')).toContainElement(block)
    expect(within(aside()).getByRole('status', { name: 'Loading conversations…' })).toBeInTheDocument()
    expect(screen.queryByText('Loading conversations…')).toBeNull()
    expect(screen.queryByText('Add a project to start a conversation.')).toBeNull()
    expect(screen.queryByText('Restore a project below or add another folder.')).toBeNull()
    expect(screen.getByText('Conversations')).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Filter conversations' })).toBeInTheDocument()
  })
})

describe('T1 · the live list replaces the cache', () => {
  it('shows the fresh rows in place of the cached ones and turns live', async () => {
    localStorage.setItem(KEY, cachedValue([{ id: 'a', title: 'Old title' }, { id: 'b', title: 'Deleted since' }]))
    mockMain({ list: async () => [conversation('a', 'New title', 30), conversation('c', 'Brand new', 20)], projects: async () => ({ projects: [project('p1', 'Atlas')], unavailable: [] }) })
    render(<ThreadSidebar onCreate={vi.fn()} />)
    expect(aside()).toHaveAttribute('data-list-source', 'cache')
    await loadLive()
    await waitFor(() => expect(titles()).toEqual(expect.arrayContaining(['New title', 'Brand new'])))
    expect(titles()).not.toContain('Old title')
    expect(titles()).not.toContain('Deleted since')
    expect(aside()).toHaveAttribute('data-list-source', 'live')
    expect(aside()).not.toHaveAttribute('aria-busy', 'true')
    expect(skeleton()).toBeNull()
    expect(useThreadStore.getState()).toMatchObject({ listLoaded: true })
  })
})

describe('T1 · the cache is written from the live list', () => {
  it('holds the newest conversations with only the allowed fields, never paths, workspace or session ids', async () => {
    const { readThreadListCache } = await cacheModule()
    mockMain({
      list: async () => [conversation('old', 'Oldest', 10), conversation('new', 'Newest', 30), conversation('mid', 'Middle', 20),
        conversation('gone', 'Archived one', 40, { archived: true }), conversation('hid', 'In a removed project', 50, { projectId: 'p2', rootPath: `${SECRET_ROOT}/p2` })],
      projects: async () => ({ projects: [project('p1', 'Atlas'), project('p2', 'Hidden', true)], unavailable: [] })
    })
    await loadLive()
    const cache = readThreadListCache()
    expect(cache?.v).toBe(1)
    expect(cachedIds(cache)).toEqual(['new', 'mid', 'old'])
    for (const row of cache!.threads) expect(ALLOWED_ROW_KEYS).toEqual(expect.arrayContaining(Object.keys(row)))
    for (const item of cache!.projects) expect(['projectId', 'displayName']).toEqual(expect.arrayContaining(Object.keys(item)))
    const raw = localStorage.getItem(KEY)!
    expect(raw).not.toContain('secret-root')
    expect(raw).not.toContain('session-secret')
    expect(raw).not.toContain('ws-secret')
    // Seeded into the store? Never: first-run detection reads `projects`, and the cache stays a paint-only copy.
    expect(useThreadStore.getState().threads.map(thread => thread.id)).toEqual(['hid', 'gone', 'new', 'mid', 'old'])
  })
})

describe('T1 · a failed load', () => {
  it('keeps the stored cache, ends the skeleton and shows the error', async () => {
    const stored = cachedValue([{ id: 'a', title: 'Fix the login bug' }])
    localStorage.setItem(KEY, stored)
    mockMain({ list: async () => { throw new Error('main is gone') } })
    render(<ThreadSidebar onCreate={vi.fn()} />)
    await act(async () => { await useThreadStore.getState().load() })
    expect(localStorage.getItem(KEY)).toBe(stored)
    expect(useThreadStore.getState()).toMatchObject({ listLoaded: true })
    expect(await screen.findByText('Could not load conversations.')).toBeInTheDocument()
    expect(skeleton()).toBeNull()
    expect(aside()).not.toHaveAttribute('aria-busy', 'true')
  })
})

describe('T1 · the cache stays small', () => {
  it('keeps at most 100 rows and 32 KiB, newest first, without archived or hidden-project rows', async () => {
    const { writeThreadListCache, readThreadListCache, THREAD_LIST_CACHE_KEY, THREAD_LIST_CACHE_MAX_ROWS, THREAD_LIST_CACHE_MAX_BYTES } = await cacheModule()
    expect(THREAD_LIST_CACHE_KEY).toBe(KEY)
    expect(THREAD_LIST_CACHE_MAX_ROWS).toBe(100)
    expect(THREAD_LIST_CACHE_MAX_BYTES).toBe(32_768)
    const visible = Array.from({ length: 1000 }, (_, index) => conversation(`t${index}`, `${index} `.padEnd(200, 'x'), 1_000 + index))
    const archived = Array.from({ length: 20 }, (_, index) => conversation(`arch${index}`, 'Archived', 5_000 + index, { archived: true }))
    const hidden = Array.from({ length: 20 }, (_, index) => conversation(`hid${index}`, 'Hidden', 6_000 + index, { projectId: 'p2' }))
    writeThreadListCache([...visible, ...archived, ...hidden], [project('p1', 'Atlas'), project('p2', 'Hidden', true)])
    const raw = localStorage.getItem(KEY)!
    expect(raw.length).toBeLessThanOrEqual(32_768)
    const rows = readThreadListCache()!.threads
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThanOrEqual(100)
    expect(rows[0].id).toBe('t999')
    const times = rows.map(row => row.updatedAt as number)
    expect(times).toEqual([...times].sort((a, b) => b - a))
    // The newest are the ones kept: no dropped visible conversation is newer than the oldest one kept.
    expect(times[times.length - 1]).toBe(1_000 + 1000 - rows.length)
    expect(rows.some(row => String(row.id).startsWith('arch') || String(row.id).startsWith('hid'))).toBe(false)
  })
})

describe('T1 · a bad cache reads as none', () => {
  it('malformed, another version or shape, oversize or a throwing storage read as no cache and never throw', async () => {
    const { readThreadListCache, writeThreadListCache, clearThreadListCache } = await cacheModule()
    expect(readThreadListCache()).toBeNull()
    for (const value of ['not json', JSON.stringify({ v: 2, savedAt: 1, threads: [], projects: [] }), JSON.stringify({ v: 1, savedAt: 1, threads: 'nope', projects: [] }), 'null', '42']) {
      localStorage.setItem(KEY, value)
      expect(readThreadListCache()).toBeNull()
    }
    localStorage.setItem(KEY, cachedValue([{ id: 'a', title: 'x'.repeat(40_000) }]))
    expect(readThreadListCache()).toBeNull()
    const throwing = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('quota') }, removeItem: () => { throw new Error('denied') } } as unknown as Storage
    expect(readThreadListCache(throwing)).toBeNull()
    expect(() => writeThreadListCache([conversation('a', 'A', 1)], [project('p1', 'Atlas')], throwing)).not.toThrow()
    expect(() => clearThreadListCache(throwing)).not.toThrow()
  })

  it('a cache of another version paints the skeleton, not its rows', () => {
    localStorage.setItem(KEY, cachedValue([{ id: 'a', title: 'From another version' }], undefined, 2))
    render(<ThreadSidebar onCreate={vi.fn()} />)
    expect(titles()).not.toContain('From another version')
    expect(screen.getByTestId('thread-sidebar-skeleton')).toBeInTheDocument()
    expect(aside()).toHaveAttribute('aria-busy', 'true')
  })
})

describe('T1 · a conversation that leaves the list leaves the cache', () => {
  const live = () => mockMain({
    list: async () => [conversation('a', 'Alpha', 30), conversation('b', 'Bravo', 20), conversation('c', 'Charlie', 10, { projectId: 'p2', rootPath: `${SECRET_ROOT}/p2` })],
    projects: async () => ({ projects: [project('p1', 'Atlas'), project('p2', 'Borealis')], unavailable: [] })
  })

  it('archiving a conversation drops its row from the cache at once', async () => {
    const { readThreadListCache } = await cacheModule()
    live()
    await loadLive()
    expect(cachedIds(readThreadListCache())).toEqual(['a', 'b', 'c'])
    api.command.mockImplementation(() => pending())
    await act(async () => { void useThreadStore.getState().archiveThread('a') })
    expect(api.command).toHaveBeenCalledWith('a', '/archive confirm')
    expect(cachedIds(readThreadListCache())).toEqual(['b', 'c'])
  })

  it('deleting a conversation from the sidebar drops its row from the cache, before the list reloads', async () => {
    const { readThreadListCache } = await cacheModule()
    live()
    const user = userEvent.setup()
    render(<ThreadSidebar onCreate={vi.fn()} />)
    await loadLive()
    expect(cachedIds(readThreadListCache())).toEqual(['a', 'b', 'c'])
    // The reload after the delete never answers: the row must already be gone from the cache.
    api.list.mockImplementation(() => pending())
    await user.click(screen.getByRole('button', { name: 'Actions for Alpha' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete conversation' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Delete this conversation?' })).getByRole('button', { name: 'Delete conversation' }))
    await waitFor(() => expect(api.command).toHaveBeenCalledWith('a', '/delete confirm'))
    await waitFor(() => expect(cachedIds(readThreadListCache())).toEqual(['b', 'c']))
  })

  it('removing a project drops its rows from the cache at once', async () => {
    const { readThreadListCache } = await cacheModule()
    live()
    await loadLive()
    api.setProjectHidden.mockImplementation(() => pending())
    await act(async () => { void useThreadStore.getState().hideProject('p2') })
    expect(cachedIds(readThreadListCache())).toEqual(['a', 'b'])
  })
})

describe('T1 · clearing the data wipes the cache', () => {
  it('clearThreadListCache removes the cache and nothing else, the cache lives under its one key, and a wiped profile paints the skeleton', async () => {
    const { writeThreadListCache, readThreadListCache, clearThreadListCache } = await cacheModule()
    const keys: string[] = []
    const recording = { getItem: (key: string) => localStorage.getItem(key), setItem: (key: string, value: string) => { keys.push(key); localStorage.setItem(key, value) }, removeItem: (key: string) => localStorage.removeItem(key) } as unknown as Storage
    writeThreadListCache([conversation('a', 'Alpha', 1)], [project('p1', 'Atlas')], recording)
    expect([...new Set(keys)]).toEqual([KEY])
    localStorage.setItem('oxe.unrelated', 'kept')
    expect(readThreadListCache()).not.toBeNull()
    clearThreadListCache()
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(readThreadListCache()).toBeNull()
    expect(localStorage.getItem('oxe.unrelated')).toBe('kept')
    render(<ThreadSidebar onCreate={vi.fn()} />)
    expect(titles()).not.toContain('Alpha')
    expect(screen.getByTestId('thread-sidebar-skeleton')).toBeInTheDocument()
  })
})

// Last: it resets the module registry.
describe('T1 · boot neutral', () => {
  it('loading the store and the cache module reads nothing of the cache', async () => {
    localStorage.setItem(KEY, cachedValue([{ id: 'a', title: 'Alpha' }]))
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    vi.resetModules()
    await import('../../../src/store/thread.store')
    await cacheModule()
    expect(getItem.mock.calls.filter(([key]) => key === KEY)).toEqual([])
  })
})
