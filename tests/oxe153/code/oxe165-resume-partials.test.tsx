import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionListInput, SessionListPartialEvent, SessionSummary } from '../../../shared/types/session'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { changeLanguage } from '../../../src/i18n'
import { ProviderSessionFinder } from '../../../src/components/Grid/ProviderSessionFinder'
import { useSessionStore } from '../../../src/store/session.store'

const ipcHandlers = new Map<string, (event: unknown, input: unknown) => unknown>()
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/oxe-test' },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, input: unknown) => unknown) => {
      ipcHandlers.set(channel, handler)
    }
  }
}))

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function makeSession(index: number, overrides: Partial<SessionSummary> = {}): SessionSummary {
  const padded = String(index).padStart(12, '0')
  const baseTime = 1_760_000_000_000
  return {
    sessionId: `00000000-0000-4000-8000-${padded}`,
    provider: 'claude',
    modelId: 'claude-sonnet-4-5',
    requestCount: 4,
    // Higher index = older, so index 1 is newest (final order is 1, 2, ..., N)
    lastUpdatedMs: baseTime - index * 60_000,
    sessionStartedAtMs: baseTime - index * 60_000 - 30_000,
    totalTokens: 1200,
    estimatedCostUsd: 0.02,
    filePath: `/tmp/00000000-0000-4000-8000-${padded}.jsonl`,
    isFork: false,
    parentSessionId: null,
    label: null,
    firstMessagePreview: `Feature task #${index}`,
    workspaceRootPath: '/work/oxespace',
    ...overrides
  }
}

interface SessionMockHarness {
  requests: Array<{ input: SessionListInput; deferred: Deferred<SessionSummary[]> }>
  listeners: Set<(event: SessionListPartialEvent) => void>
  unsubscribedCount: () => number
  emitPartial: (event: SessionListPartialEvent) => void
}

function installSessionMock(options: { withOnPartial?: boolean } = {}): SessionMockHarness {
  const withOnPartial = options.withOnPartial ?? true
  const requests: Array<{ input: SessionListInput; deferred: Deferred<SessionSummary[]> }> = []
  const listeners = new Set<(event: SessionListPartialEvent) => void>()
  let unsubCount = 0

  const sessionApi: Record<string, unknown> = {
    list: vi.fn((input: SessionListInput) => {
      const d = deferred<SessionSummary[]>()
      requests.push({ input, deferred: d })
      return d.promise
    }),
    search: vi.fn(async () => ({ hits: [], indexing: false })),
    fork: vi.fn(),
    delete: vi.fn(),
    cleanup: vi.fn()
  }

  if (withOnPartial) {
    sessionApi.onPartial = vi.fn((listener: (event: SessionListPartialEvent) => void) => {
      listeners.add(listener)
      return () => {
        if (listeners.delete(listener)) unsubCount++
      }
    })
  }

  ;(window as unknown as { oxe: unknown }).oxe = {
    session: sessionApi,
    clipboard: { writeText: vi.fn(async () => true) }
  }

  return {
    requests,
    listeners,
    unsubscribedCount: () => unsubCount,
    emitPartial: (event: SessionListPartialEvent) => {
      for (const listener of [...listeners]) listener(event)
    }
  }
}

beforeEach(async () => {
  await changeLanguage('en')
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-density')
  ipcHandlers.clear()
  useSessionStore.setState({ byKey: {}, loading: {} })
})

afterEach(() => {
  cleanup()
  delete (window as unknown as { oxe?: unknown }).oxe
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-density')
})

describe('OXE-165 /resume progressive partial session listing', () => {
  it('renders partial session lists progressively in final order while scan is still running across themes and densities', async () => {
    const allSessions = Array.from({ length: 24 }, (_, idx) => makeSession(idx + 1))

    for (const theme of ['light', 'dark'] as const) {
      for (const density of ['compact', 'comfortable'] as const) {
        document.documentElement.setAttribute('data-theme', theme)
        document.documentElement.setAttribute('data-density', density)
        const harness = installSessionMock()

        const { unmount } = render(
          <ProviderSessionFinder workspaceId="ws-1" rootPath="/work/oxespace" onClose={vi.fn()} />
        )
        const dialog = screen.getByRole('dialog')

        // Initial loading state before any partial arrives
        expect(screen.getByRole('status')).toHaveTextContent(/Loading native sessions/i)

        const claudeReq = harness.requests.find(r => r.input.provider === 'claude')
        const codexReq = harness.requests.find(r => r.input.provider === 'codex')
        expect(claudeReq?.input.requestId).toBeTruthy()
        expect(codexReq?.input.requestId).toBeTruthy()

        // Codex finishes empty while Claude is still scanning
        await act(async () => {
          codexReq!.deferred.resolve([])
          await Promise.resolve()
        })

        // Partial #1: first 10 newest sessions arrive while scan is still running
        await act(async () => {
          harness.emitPartial({
            requestId: claudeReq!.input.requestId!,
            workspaceId: 'ws-1',
            workspaceRootPath: '/work/oxespace',
            provider: 'claude',
            sessions: allSessions.slice(0, 10)
          })
        })

        const cardsAfterFirst = Array.from(dialog.querySelectorAll<HTMLElement>('.desktop-provider-session-card'))
        expect(cardsAfterFirst).toHaveLength(10)
        expect(cardsAfterFirst.map(el => el.dataset.sessionId)).toEqual(allSessions.slice(0, 10).map(s => s.sessionId))
        // Incremental loading indicator remains visible alongside partial results
        expect(screen.getByRole('status')).toHaveTextContent(/Loading more sessions/i)
        expect(document.documentElement.getAttribute('data-theme')).toBe(theme)
        expect(document.documentElement.getAttribute('data-density')).toBe(density)

        // Partial #2: first 20 newest sessions arrive (prefix of final order, no duplicates)
        await act(async () => {
          harness.emitPartial({
            requestId: claudeReq!.input.requestId!,
            workspaceId: 'ws-1',
            workspaceRootPath: '/work/oxespace',
            provider: 'claude',
            sessions: allSessions.slice(0, 20)
          })
        })

        const cardsAfterSecond = Array.from(dialog.querySelectorAll<HTMLElement>('.desktop-provider-session-card'))
        expect(cardsAfterSecond).toHaveLength(20)
        expect(cardsAfterSecond.map(el => el.dataset.sessionId)).toEqual(allSessions.slice(0, 20).map(s => s.sessionId))
        expect(screen.getByRole('status')).toHaveTextContent(/Loading more sessions/i)

        // Final authoritative list resolves (24 sessions); spinner disappears
        await act(async () => {
          claudeReq!.deferred.resolve(allSessions)
          await Promise.resolve()
        })

        await waitFor(() => {
          expect(screen.queryByRole('status')).toBeNull()
        })
        const finalCards = Array.from(dialog.querySelectorAll<HTMLElement>('.desktop-provider-session-card'))
        expect(finalCards).toHaveLength(24)
        expect(finalCards.map(el => el.dataset.sessionId)).toEqual(allSessions.map(s => s.sessionId))

        unmount()
      }
    }

    // RT-3 fallback: legacy mocks without window.oxe.session.onPartial still work cleanly
    const legacyHarness = installSessionMock({ withOnPartial: false })
    const { unmount: unmountLegacy } = render(
      <ProviderSessionFinder workspaceId="ws-1" rootPath="/work/oxespace" onClose={vi.fn()} />
    )
    await act(async () => {
      legacyHarness.requests.find(r => r.input.provider === 'codex')!.deferred.resolve([])
      legacyHarness.requests.find(r => r.input.provider === 'claude')!.deferred.resolve(allSessions.slice(0, 3))
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull()
    })
    expect(screen.getByText('Feature task #1')).toBeTruthy()
    unmountLegacy()
  })

  it('preserves selected sessionId, scrollTop and search query when subsequent partials and final list arrive', async () => {
    const allSessions = Array.from({ length: 24 }, (_, idx) => makeSession(idx + 1, {
      firstMessagePreview: idx % 2 === 0 ? `Auth feature #${idx + 1}` : `Other chore #${idx + 1}`
    }))
    const harness = installSessionMock()

    render(
      <ProviderSessionFinder workspaceId="ws-1" rootPath="/work/oxespace" onClose={vi.fn()} />
    )
    const dialog = screen.getByRole('dialog')

    const claudeReq = harness.requests.find(r => r.input.provider === 'claude')!
    const codexReq = harness.requests.find(r => r.input.provider === 'codex')!

    // Emit partial #1 (12 sessions -> 6 match "Auth")
    await act(async () => {
      harness.emitPartial({
        requestId: claudeReq.input.requestId!,
        workspaceId: 'ws-1',
        workspaceRootPath: '/work/oxespace',
        provider: 'claude',
        sessions: allSessions.slice(0, 12)
      })
    })

    // User types a search query
    const searchInput = screen.getByRole('searchbox', { name: /Search native sessions/i }) as HTMLInputElement
    fireEvent.change(searchInput, { target: { value: 'Auth' } })
    expect(searchInput.value).toBe('Auth')

    const listEl = dialog.querySelector<HTMLElement>('.desktop-provider-session-list')!
    expect(listEl).toBeTruthy()

    // User selects item k (3rd matching card, index 2 -> session #5) via click + keyboard focus
    const initialCards = Array.from(listEl.querySelectorAll<HTMLElement>('.desktop-provider-session-card'))
    expect(initialCards).toHaveLength(6)
    const targetCard = initialCards[2]
    const selectedId = targetCard.dataset.sessionId!
    fireEvent.click(targetCard)
    targetCard.focus()
    expect(targetCard.getAttribute('data-selected')).toBe('true')
    expect(targetCard.getAttribute('aria-current')).toBe('true')
    expect(document.activeElement).toBe(targetCard)

    // User scrolls the list
    listEl.scrollTop = 240
    fireEvent.scroll(listEl)
    expect(listEl.scrollTop).toBe(240)

    // RN-2: stale partial with an obsolete requestId is silently discarded
    await act(async () => {
      harness.emitPartial({
        requestId: 'resume:stale-999:claude',
        workspaceId: 'ws-1',
        workspaceRootPath: '/work/oxespace',
        provider: 'claude',
        sessions: [makeSession(999, { firstMessagePreview: 'Auth STALE' })]
      })
    })
    expect(screen.queryByText('Auth STALE')).toBeNull()

    // Partial #2 arrives (20 sessions -> 10 match "Auth")
    await act(async () => {
      harness.emitPartial({
        requestId: claudeReq.input.requestId!,
        workspaceId: 'ws-1',
        workspaceRootPath: '/work/oxespace',
        provider: 'claude',
        sessions: allSessions.slice(0, 20)
      })
    })

    expect(searchInput.value).toBe('Auth')
    expect(listEl.scrollTop).toBe(240)
    expect(document.activeElement).toBe(targetCard)
    const selectedAfterPartial = listEl.querySelector<HTMLElement>('[data-selected="true"]')
    expect(selectedAfterPartial?.dataset.sessionId).toBe(selectedId)
    expect(listEl.querySelectorAll('.desktop-provider-session-card')).toHaveLength(10)

    // Final authoritative list resolves (24 sessions -> 12 match "Auth")
    await act(async () => {
      codexReq.deferred.resolve([])
      claudeReq.deferred.resolve(allSessions)
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull()
    })

    expect(searchInput.value).toBe('Auth')
    expect(listEl.scrollTop).toBe(240)
    expect(document.activeElement).toBe(targetCard)
    const selectedAfterFinal = listEl.querySelector<HTMLElement>('[data-selected="true"]')
    expect(selectedAfterFinal?.dataset.sessionId).toBe(selectedId)
    expect(selectedAfterFinal?.getAttribute('aria-current')).toBe('true')
    expect(listEl.querySelectorAll('.desktop-provider-session-card')).toHaveLength(12)
  })

  it('cleans up partial IPC subscription on close and throttles emissions', async () => {
    // Part A: Closing the dialog immediately unsubscribes and drops late partials without leaking listeners
    const harness = installSessionMock()
    const { unmount } = render(
      <ProviderSessionFinder workspaceId="ws-1" rootPath="/work/oxespace" onClose={vi.fn()} />
    )

    expect(harness.listeners.size).toBe(1)
    const claudeReq = harness.requests.find(r => r.input.provider === 'claude')!
    const codexReq = harness.requests.find(r => r.input.provider === 'codex')!

    unmount()
    expect(harness.unsubscribedCount()).toBe(1)
    expect(harness.listeners.size).toBe(0)

    // Late partial and late resolution after unmount must not throw or leak
    await act(async () => {
      harness.emitPartial({
        requestId: claudeReq.input.requestId!,
        workspaceId: 'ws-1',
        workspaceRootPath: '/work/oxespace',
        provider: 'claude',
        sessions: [makeSession(1)]
      })
      claudeReq.deferred.resolve([makeSession(1)])
      codexReq.deferred.resolve([])
      await Promise.resolve()
    })

    // Part B: Main-process IPC handler throttles rapid partial bursts (50ms / batch of 10) and cleans up on completion
    vi.useFakeTimers()
    try {
      const { registerSessionIpc, SESSION_PARTIAL_BATCH_SIZE, SESSION_PARTIAL_INTERVAL_MS } = await import('../../../electron/main/ipc/session.ipc')
      const all = Array.from({ length: 35 }, (_, idx) => makeSession(idx + 1))
      const finishScan = deferred<SessionSummary[]>()
      let partialCallback: ((sessions: SessionSummary[]) => void) | undefined

      const fakeService = {
        listSessions: vi.fn(async (_ws: string, _root: string, _provider: string, onPartial?: (s: SessionSummary[]) => void) => {
          partialCallback = onPartial
          // Emit 35 rapid partials inside < 50ms (simulating fast scan of a huge workspace)
          for (let i = 1; i <= all.length; i++) {
            onPartial?.(all.slice(0, i))
          }
          return finishScan.promise
        })
      }

      registerSessionIpc({} as never, fakeService as never)
      const listHandler = ipcHandlers.get(IPC_CHANNELS.session.list)!
      expect(listHandler).toBeTypeOf('function')

      const sent: Array<{ channel: string; payload: SessionListPartialEvent }> = []
      let destroyed = false
      const event = {
        sender: {
          isDestroyed: () => destroyed,
          send: (channel: string, payload: SessionListPartialEvent) => {
            sent.push({ channel, payload })
          }
        }
      }

      const listPromise = listHandler(event, {
        workspaceId: 'ws-1',
        workspaceRootPath: '/work/oxespace',
        provider: 'claude',
        requestId: 'req-throttle-1'
      }) as Promise<SessionSummary[]>

      // Wait a microtask for listSessions to fire the 35 rapid partials
      await Promise.resolve()

      // First partial (1) + batches of 10 (11, 21, 31) = 4 emissions instead of 35!
      expect(SESSION_PARTIAL_BATCH_SIZE).toBe(10)
      expect(SESSION_PARTIAL_INTERVAL_MS).toBe(50)
      expect(sent).toHaveLength(4)
      expect(sent.map(entry => entry.payload.sessions.length)).toEqual([1, 11, 21, 31])
      expect(sent.every(entry => entry.channel === IPC_CHANNELS.session.onPartial && entry.payload.requestId === 'req-throttle-1')).toBe(true)

      // Advancing 50ms flushes the trailing buffered partial (35) while scan is still running
      vi.advanceTimersByTime(50)
      expect(sent).toHaveLength(5)
      expect(sent[4].payload.sessions).toHaveLength(35)

      // Finish scan: pending timers are cleared and no extra emission happens after completion
      finishScan.resolve(all)
      const finalResult = await listPromise
      expect(finalResult).toHaveLength(35)

      // Destroyed sender stops receiving even if a rogue callback fires later
      destroyed = true
      partialCallback?.(all)
      vi.advanceTimersByTime(100)
      expect(sent).toHaveLength(5)
    } finally {
      vi.useRealTimers()
    }

    // Part C: useSessionStore also streams partials and ignores obsolete requestIds
    const storeHarness = installSessionMock()
    const loadPromise = useSessionStore.getState().load('ws-store', '/work/oxespace', 'claude')
    const storeReq = storeHarness.requests[0]
    expect(storeReq.input.requestId).toBeTruthy()
    storeHarness.emitPartial({
      requestId: 'stale-store-req',
      workspaceId: 'ws-store',
      workspaceRootPath: '/work/oxespace',
      provider: 'claude',
      sessions: [makeSession(99)]
    })
    expect(useSessionStore.getState().byKey['ws-store|claude']).toBeUndefined()
    storeHarness.emitPartial({
      requestId: storeReq.input.requestId!,
      workspaceId: 'ws-store',
      workspaceRootPath: '/work/oxespace',
      provider: 'claude',
      sessions: [makeSession(1), makeSession(2)]
    })
    expect(useSessionStore.getState().byKey['ws-store|claude']).toHaveLength(2)
    storeReq.deferred.resolve([makeSession(1), makeSession(2), makeSession(3)])
    await loadPromise
    expect(useSessionStore.getState().byKey['ws-store|claude']).toHaveLength(3)
    expect(storeHarness.listeners.size).toBe(0)
  })
})
