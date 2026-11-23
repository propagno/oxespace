import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ThreadSnapshot } from '../../../shared/types/thread'
import type { Workspace } from '../../../shared/types/workspace'
import { changeLanguage } from '../../../src/i18n'
import { useAccountStore } from '../../../src/store/account.store'
import { useThreadStore } from '../../../src/store/thread.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { ThreadDockChanges } from '../../../src/components/Threads/ThreadDockChanges'
import { ThreadTurnReview } from '../../../src/components/Threads/ThreadTurnReview'
import { ThreadView } from '../../../src/components/Threads/ThreadView'

vi.mock('../../../src/hooks/useGitBranch', () => ({
  useGitBranch: () => ({ branch: 'feat/oxe-402', detached: false, shortSha: null, error: null })
}))

const readCss = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')

function observeWidth(width: number): void {
  const entry = (target: Element) => ({
    target,
    contentRect: { width, height: 40, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 40 },
    contentBoxSize: [{ inlineSize: width, blockSize: 40 }],
    borderBoxSize: [{ inlineSize: width, blockSize: 40 }],
    devicePixelContentBoxSize: [{ inlineSize: width, blockSize: 40 }]
  })
  class FakeResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void {
      this.callback([entry(target)] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver)
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(width)
}

const originalOxe = window.oxe

beforeEach(async () => {
  await changeLanguage('en')
  localStorage.clear()
})

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.oxe = originalOxe
  localStorage.clear()
  await changeLanguage('en')
})

describe('OXE-402 · working-set bar, composer overflow, popover descriptions and diff colors', () => {
  const snapshot = {
    thread: { id: 'th-402', workspaceId: 'ws', rootPath: '/repo', updatedAt: 1, status: 'idle' },
    events: [],
    turns: [{ id: 't1', status: 'completed' }, { id: 't2', status: 'completed' }]
  } as unknown as ThreadSnapshot

  test('gates Undo all behind a danger ConfirmDialog and supports canceling or confirming', async () => {
    const turnFiles = vi.fn(async (_thread: string, turnId: string) =>
      turnId === 't1'
        ? [{ path: 'src/a.ts', state: 'pending', additions: 5, deletions: 1 }]
        : [{ path: 'src/b.ts', state: 'pending', additions: 10, deletions: 2 }]
    )
    const undoTurnFile = vi.fn(async () => undefined)
    window.oxe = { ...originalOxe, thread: { ...originalOxe?.thread, turnFiles, undoTurnFile } } as typeof window.oxe

    render(<ThreadDockChanges snapshot={snapshot} running={false} onViewChanges={() => {}} />)
    await screen.findByRole('button', { name: /2 files changed/ })

    fireEvent.click(screen.getByRole('button', { name: 'Undo all' }))
    expect(undoTurnFile).not.toHaveBeenCalled()

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()
    const cancelBtn = within(dialog).getByRole('button', { name: 'Cancel' })
    fireEvent.click(cancelBtn)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(undoTurnFile).not.toHaveBeenCalled()

    // Click again and confirm
    turnFiles.mockResolvedValue([])
    fireEvent.click(screen.getByRole('button', { name: 'Undo all' }))
    const dialog2 = await screen.findByRole('dialog')
    const confirmBtn = within(dialog2).getByRole('button', { name: 'Undo all' })
    expect(confirmBtn).toHaveAttribute('data-variant', 'danger')
    await act(async () => { fireEvent.click(confirmBtn) })
    expect(undoTurnFile.mock.calls).toEqual([['th-402', 't2', 'src/b.ts'], ['th-402', 't1', 'src/a.ts']])
  })

  test('marks working-set with data-has-error when collapsed undo fails so ErrorState is not clipped', async () => {
    const turnFiles = vi.fn(async (_thread: string, turnId: string) =>
      turnId === 't1' ? [{ path: 'src/a.ts', state: 'pending', additions: 3, deletions: 0 }] : []
    )
    const undoTurnFile = vi.fn(async () => { throw new Error('Restore blocked: file changed') })
    window.oxe = { ...originalOxe, thread: { ...originalOxe?.thread, turnFiles, undoTurnFile } } as typeof window.oxe

    render(<ThreadDockChanges snapshot={snapshot} running={false} onViewChanges={() => {}} />)
    const bar = await screen.findByTestId('thread-dock-changes')
    expect(bar).not.toHaveAttribute('data-open')
    expect(bar).not.toHaveAttribute('data-has-error')

    fireEvent.click(screen.getByRole('button', { name: 'Undo all' }))
    const dialog = await screen.findByRole('dialog')
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Undo all' })) })

    expect(await screen.findByRole('alert')).toHaveTextContent(/Restore blocked: file changed/)
    expect(bar).toHaveAttribute('data-has-error', 'true')
  })

  test('expanded file paths are clickable src/ui Buttons that call onViewChanges with the file path', async () => {
    const turnFiles = vi.fn(async (_thread: string, turnId: string) =>
      turnId === 't1' ? [{ path: 'src/pix/refund.ts', state: 'pending', additions: 12, deletions: 3 }] : []
    )
    const onViewChanges = vi.fn()
    window.oxe = { ...originalOxe, thread: { ...originalOxe?.thread, turnFiles } } as typeof window.oxe

    render(<ThreadDockChanges snapshot={snapshot} running={false} onViewChanges={onViewChanges} />)
    fireEvent.click(await screen.findByRole('button', { name: /1 file changed/ }))

    const fileBtn = screen.getByRole('button', { name: 'src/pix/refund.ts' })
    expect(fileBtn).toHaveAttribute('data-ui', 'button')
    fireEvent.click(fileBtn)
    expect(onViewChanges).toHaveBeenCalledWith('src/pix/refund.ts')
  })

  test('keeps Steer accessible when running even in narrow composer mode (< 420 px)', () => {
    observeWidth(380)
    const thread = {
      id: 'thread', workspaceId: 'ws', projectId: 'project', rootPath: '/repo', provider: 'claude',
      title: 'Narrow steer', pinned: false, status: 'running', nativeSessionId: 'native-1',
      createdAt: 1, updatedAt: 1, access: 'workspace-write', mode: 'default'
    }
    const snap = {
      thread,
      events: [{ type: 'message', id: 'u1', role: 'user', text: 'Run build' }],
      turns: [{ id: 'u1', sequence: 1, status: 'running', configuration: {} }]
    }
    const api = {
      commands: vi.fn(async () => ({ commands: [] })),
      projects: vi.fn(async () => ({ projects: [], unavailable: [] })),
      list: vi.fn(async () => [thread]),
      create: vi.fn(async () => snap),
      read: vi.fn(async () => snap),
      models: vi.fn(async () => ({ defaultModel: 'm1', models: [{ id: 'm1', label: 'Model 1', description: 'Fast', efforts: ['low', 'high'], defaultEffort: 'low' }] })),
      configure: vi.fn(async () => snap),
      send: vi.fn(async () => {}),
      steer: vi.fn(async () => {}),
      interrupt: vi.fn(async () => {}),
      approve: vi.fn(async () => {}),
      respond: vi.fn(async () => {}),
      pin: vi.fn(async () => {}),
      onChanged: vi.fn(() => () => {}),
      command: vi.fn(async () => ({ kind: 'applied' })),
      turnFiles: vi.fn(async () => []),
      places: vi.fn(async () => ({ places: [], capped: false, refused: 0 })),
      onPlacesChanged: vi.fn(() => () => {}),
      collisions: vi.fn(async () => [])
    }
    Object.defineProperty(window, 'oxe', {
      configurable: true,
      value: {
        thread: api,
        clipboard: { writeText: vi.fn(async () => true) },
        agentAccount: { read: vi.fn(async () => ({ provider: 'claude', scopeId: 'test', state: 'connected', method: 'subscription', checkedAt: 1 })) }
      }
    })
    const workspace = { id: 'ws', name: 'Repo', rootPath: '/repo', panes: [] } as unknown as Workspace
    useAccountStore.setState({ scopes: {}, snapshots: {} })
    useWorkspaceStore.setState({ workspaces: [workspace] })
    useThreadStore.setState({
      threads: [thread],
      projects: [{ projectId: 'project', displayName: 'Repo', identityLabel: '/repo', hidden: false, contexts: [{ rootPath: '/repo', label: 'Repo' }] }],
      snapshot: snap,
      selectedId: 'thread',
      secondaryId: null,
      drafts: {},
      attachments: {}
    } as never)

    render(<ThreadView workspace={workspace} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Also update tests' } })
    const toolbar = document.querySelector<HTMLElement>('[data-ui="composer-toolbar"]')!
    expect(toolbar).toHaveAttribute('data-width', 'narrow')
    expect(within(toolbar).getByRole('button', { name: 'Steer active turn' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Stop turn' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Queue follow-up' })).toBeInTheDocument()
  })

  test('ThreadTurnReview switches to All changes when This turn has 0 files and All changes has > 0 files', async () => {
    const onShowAll = vi.fn()
    const turnFiles = vi.fn(async () => [])
    const places = vi.fn(async () => ({
      places: [{ id: 'p1', kind: 'main', path: '/repo', writes: 2, files: ['src/app.ts'], drift: null }],
      capped: false
    }))
    window.oxe = { ...originalOxe, thread: { ...originalOxe?.thread, turnFiles, places } } as typeof window.oxe

    render(<ThreadTurnReview snapshot={snapshot} turnId="t1" onShowAll={onShowAll} onComment={() => {}} />)
    await waitFor(() => expect(onShowAll).toHaveBeenCalledTimes(1))
  })

  test('CSS contracts: narrow working-set, 560px composer overflow, visible popover descriptions, Effort divider, and diff line colors', () => {
    const composerCss = readCss('src/components/Threads/ThreadComposerChrome.css')
    expect(composerCss).toMatch(/@container\s+thread-composer\s*\(\s*max-width:\s*560px\s*\)/)
    expect(composerCss).toMatch(/@container\s+thread-composer\s*\(\s*max-width:\s*480px\s*\)/)
    expect(composerCss).toMatch(/\[data-ui='working-set'\]\[data-has-error='true'\]/)
    expect(composerCss).toMatch(/\.thread-dock-changes-summary[^}]*text-overflow:\s*ellipsis/)
    expect(composerCss).not.toMatch(/\.thread-config-options button small\s*\{[^}]*width:\s*1px/)
    expect(composerCss).toMatch(/\.thread-config-options button small\s*\{[^}]*color:\s*var\(--tx-muted\)/)
    expect(composerCss).toMatch(/\.thread-config-options\s*\+\s*\.thread-config-section-label\s*\{[^}]*border-top:\s*1px solid var\(--bd-subtle\)/)

    const placesCss = readCss('src/components/Threads/PlacesChanges.css')
    expect(placesCss).toMatch(/\.place-hunk-line\[data-line-type="added"\][^}]*background:\s*var\(--diff-add-bg\)/)
    expect(placesCss).toMatch(/\.place-hunk-line\[data-line-type="removed"\][^}]*background:\s*var\(--diff-del-bg\)/)
    expect(placesCss).toMatch(/content:\s*'\+'/)
    expect(placesCss).toMatch(/content:\s*'−'/)
  })
})
