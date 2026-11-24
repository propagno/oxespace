import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChangesPanel } from '../../src/components/Changes/ChangesPanel'
import { PrStatusBar } from '../../src/components/GitHub/PrStatusBar'
import { NativePreviewHost } from '../../src/components/WebPreview/NativePreviewHost'
import { WebPreviewPanel } from '../../src/components/WebPreview/WebPreviewPanel'
import { isElementVisible } from '../../src/hooks/useElementVisibility'
import type { BrowserPreviewSessionState } from '../../shared/types/browser-preview'
import type { Workspace } from '../../shared/types/workspace'

vi.mock('../../src/components/Changes/MonacoDiff', () => ({
  default: () => <div data-testid="mock-monaco-diff" />
}))

const flushMicrotasks = async (turns = 6): Promise<void> => {
  for (let i = 0; i < turns; i += 1) await Promise.resolve()
}

const setDocumentHidden = (hidden: boolean): void => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden })
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: hidden ? 'hidden' : 'visible' })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('OXE-350 · hidden git/gh pollers and WebPreview IPC coalescing', () => {
  const originalOxe = window.oxe

  beforeEach(() => {
    vi.useFakeTimers()
    setDocumentHidden(false)
  })

  afterEach(() => {
    cleanup()
    setDocumentHidden(false)
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Object.defineProperty(window, 'oxe', { configurable: true, value: originalOxe })
  })

  it('ChangesPanel pauses 10s git polling when hidden via display:none and refreshes once on becoming visible', async () => {
    const getDiffSummary = vi.fn(async () => ({
      base: 'main',
      head: 'WORKTREE',
      files: [{ path: 'src/a.ts', status: 'M' as const, additions: 1, deletions: 0, binary: false }],
      additions: 1,
      deletions: 0,
      compiledAt: Date.now()
    }))
    const getFileOriginal = vi.fn(async () => ({ content: 'const a = 1\n', truncated: false }))
    const readFile = vi.fn(async () => ({ content: 'const a = 2\n' }))

    Object.defineProperty(window, 'oxe', {
      configurable: true,
      value: {
        git: {
          getBranch: vi.fn(async () => ({ branch: 'feat/test', shortSha: 'abc1234' })),
          getDiffSummary,
          getFileOriginal
        },
        github: {
          listBranches: vi.fn(async () => [{ name: 'main', remote: false }]),
          resolveWorktreeBase: vi.fn(async () => ({ baseRef: 'main' })),
          listWorktrees: vi.fn(async () => [])
        },
        fs: { readFile }
      }
    })

    const view = render(
      <div data-testid="host" style={{ display: 'block' }}>
        <ChangesPanel workspaceId="ws-1" rootPath="/repo" />
      </div>
    )
    await act(async () => { await flushMicrotasks() })
    expect(getDiffSummary).toHaveBeenCalledTimes(1)

    // Hide the ancestor surface via display: none (like an inactive tab/surface).
    const host = view.getByTestId('host')
    await act(async () => {
      host.style.display = 'none'
      await flushMicrotasks()
    })

    const countWhileHidden = getDiffSummary.mock.calls.length
    await act(async () => {
      vi.advanceTimersByTime(60_000)
      await flushMicrotasks()
    })
    expect(getDiffSummary).toHaveBeenCalledTimes(countWhileHidden)

    // Show the surface again: refreshes once immediately, then resumes 10s polling.
    await act(async () => {
      host.style.display = 'block'
      await flushMicrotasks()
    })
    expect(getDiffSummary).toHaveBeenCalledTimes(countWhileHidden + 1)

    await act(async () => {
      vi.advanceTimersByTime(10_000)
      await flushMicrotasks()
    })
    expect(getDiffSummary).toHaveBeenCalledTimes(countWhileHidden + 2)
  })

  it('PrStatusBar pauses 30s gh polling when hidden (display:none or document.hidden) and refreshes on show', async () => {
    const getPullRequestStatus = vi.fn(async () => ({
      number: 42,
      title: 'Test PR',
      state: 'OPEN' as const,
      isDraft: false,
      url: 'https://github.com/o/r/pull/42',
      headRefName: 'feat/test',
      baseRefName: 'main',
      autoMerge: false,
      checks: []
    }))

    Object.defineProperty(window, 'oxe', {
      configurable: true,
      value: { github: { getPullRequestStatus } }
    })

    const view = render(
      <div data-testid="pr-host" style={{ display: 'block' }}>
        <PrStatusBar workspaceId="ws-1" rootPath="/repo" />
      </div>
    )
    await act(async () => { await flushMicrotasks() })
    expect(getPullRequestStatus).toHaveBeenCalledTimes(1)

    // Hide via display: none -> 2 minutes pass with zero gh calls.
    const host = view.getByTestId('pr-host')
    await act(async () => {
      host.style.display = 'none'
      await flushMicrotasks()
    })
    await act(async () => {
      vi.advanceTimersByTime(120_000)
      await flushMicrotasks()
    })
    expect(getPullRequestStatus).toHaveBeenCalledTimes(1)

    // Re-show -> immediate refresh once.
    await act(async () => {
      host.style.display = 'block'
      await flushMicrotasks()
    })
    expect(getPullRequestStatus).toHaveBeenCalledTimes(2)

    // Hide via document.hidden -> 60s pass with zero gh calls.
    await act(async () => {
      setDocumentHidden(true)
      await flushMicrotasks()
    })
    await act(async () => {
      vi.advanceTimersByTime(60_000)
      await flushMicrotasks()
    })
    expect(getPullRequestStatus).toHaveBeenCalledTimes(2)

    // Document visible again -> immediate refresh once.
    await act(async () => {
      setDocumentHidden(false)
      await flushMicrotasks()
    })
    expect(getPullRequestStatus).toHaveBeenCalledTimes(3)
  })

  it('isElementVisible handles display:contents anchors whose Chromium checkVisibility() returns false', () => {
    const ancestor = document.createElement('div')
    ancestor.style.display = 'block'
    const parent = document.createElement('div')
    parent.style.display = 'block'
    const anchor = document.createElement('span')
    anchor.style.display = 'contents'

    // Simulate real Chromium: display:contents elements have no layout box so checkVisibility() is always false.
    ;(anchor as unknown as { checkVisibility: () => boolean }).checkVisibility = vi.fn(() => false)
    const parentCheckVisibility = vi.fn(() => true)
    ;(parent as unknown as { checkVisibility: () => boolean }).checkVisibility = parentCheckVisibility

    parent.append(anchor)
    ancestor.append(parent)
    document.body.append(ancestor)

    try {
      expect(isElementVisible(anchor)).toBe(true)
      expect(parentCheckVisibility).toHaveBeenCalledTimes(1)

      ancestor.style.display = 'none'
      expect(isElementVisible(anchor)).toBe(false)

      ancestor.style.display = 'block'
      parentCheckVisibility.mockReturnValue(false)
      expect(isElementVisible(anchor)).toBe(false)
    } finally {
      ancestor.remove()
    }
  })

  it('WebPreviewPanel deduplicates setAccess IPC calls while typing in the address bar', async () => {
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} })
    ;(HTMLElement.prototype as unknown as { checkVisibility: () => boolean }).checkVisibility = () => true
    const setAccess = vi.fn(async () => ({ agentAccess: false }))
    const session = vi.fn(async () => ({
      ownerKey: 'ws-1',
      activeTabId: 'tab-1',
      tabs: [{ id: 'tab-1', url: 'http://localhost:3000/', loading: false, error: null, canGoBack: false, canGoForward: false }]
    }) as BrowserPreviewSessionState)

    Object.defineProperty(window, 'oxe', {
      configurable: true,
      value: {
        browserPreview: {
          session,
          onEvent: () => () => {},
          designMode: vi.fn(async () => undefined),
          setAccess,
          mount: vi.fn(async () => ({ lease: 'l1' })),
          bounds: vi.fn(async () => undefined),
          setZoom: vi.fn(async () => undefined),
          close: vi.fn(async () => undefined)
        },
        fs: {
          readFile: vi.fn(async () => ({ content: '' })),
          listTree: vi.fn(async () => [])
        }
      }
    })

    const view = render(<WebPreviewPanel workspace={{ id: 'ws-1', name: 'Demo', rootPath: '' } as Workspace} onClose={() => {}} />)
    await act(async () => { await flushMicrotasks() })
    expect(setAccess).toHaveBeenCalledTimes(1)

    // Rapidly typing 10 edits in the address bar mutates `tabs` each time, but must NOT emit extra setAccess IPCs.
    const input = view.getByRole('textbox', { name: 'Preview address' })
    for (let i = 0; i < 10; i += 1) {
      fireEvent.change(input, { target: { value: `http://localhost:300${i}` } })
    }
    await act(async () => { await flushMicrotasks() })
    expect(setAccess).toHaveBeenCalledTimes(1)
  })

  it('NativePreviewHost coalesces rapid geometry-only bounds bursts while flushing visibility changes immediately', async () => {
    const bounds = vi.fn(async () => undefined)
    let width = 300
    let rafCallbacks: Array<FrameRequestCallback> = []

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { rafCallbacks = [] })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      x: 10.4,
      y: 20.6,
      width,
      height: 200.2,
      top: 20.6,
      left: 10.4,
      right: 10.4 + width,
      bottom: 220.8,
      toJSON: () => ({})
    }) as DOMRect)
    ;(HTMLElement.prototype as unknown as { checkVisibility: () => boolean }).checkVisibility = () => true
    vi.stubGlobal('ResizeObserver', class { observe(): void {} unobserve(): void {} disconnect(): void {} })
    Object.defineProperty(window, 'oxe', {
      configurable: true,
      value: {
        browserPreview: {
          mount: async () => ({ lease: 'l1' }),
          bounds,
          setZoom: async () => undefined,
          close: async () => undefined
        }
      }
    })

    const flushRaf = (): void => {
      const pending = rafCallbacks.splice(0)
      for (const cb of pending) cb(performance.now())
    }

    render(
      <NativePreviewHost
        mount={{ ownerKey: 'ws', tabId: 't1', url: 'http://localhost:3000/', workspaceId: 'ws', allowExternal: false, agentAccess: false }}
        active
        zoom={100}
      />
    )
    await act(async () => { await flushMicrotasks() })
    await act(async () => { flushRaf(); await flushMicrotasks() })
    // Initial measurement sent immediately with integer-rounded coordinates.
    expect(bounds).toHaveBeenCalledTimes(1)
    expect(bounds.mock.calls[0][0]).toMatchObject({ x: 10, y: 21, width: 300, height: 200, visible: true })

    // Simulate 8 rapid resize frames within 24ms: all coalesce into a single trailing bounds IPC.
    for (let i = 1; i <= 8; i += 1) {
      width = 300 + i * 10
      await act(async () => {
        window.dispatchEvent(new Event('resize'))
        vi.advanceTimersByTime(3)
        flushRaf()
      })
    }
    expect(bounds).toHaveBeenCalledTimes(1)

    // Once the 48ms coalesce window elapses, exactly one trailing bounds IPC fires with the final width (380).
    await act(async () => {
      vi.advanceTimersByTime(40)
      await flushMicrotasks()
    })
    expect(bounds).toHaveBeenCalledTimes(2)
    expect(bounds.mock.calls[1][0]).toMatchObject({ width: 380, visible: true })

    // Visibility transition (dialog covers preview) flushes immediately even inside the coalesce window.
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    await act(async () => {
      document.body.append(dialog)
      await flushMicrotasks()
      flushRaf()
    })
    expect(bounds).toHaveBeenCalledTimes(3)
    expect(bounds.mock.calls[2][0]).toMatchObject({ visible: false })
    dialog.remove()
  })
})
