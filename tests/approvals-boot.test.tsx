import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../shared/locales/en/common.json'
import ptBR from '../shared/locales/pt-BR/common.json'
import { approvalsApi, realApprovalsApi, resetApprovalsApi } from '../src/components/Approvals/approvalsApi'
import { PRELOAD_FALLBACK_MS, resetApprovalsBoot, schedulePreload, SHOW_TIMEOUT_MS, startApprovals, type CenterModule } from '../src/components/Approvals/approvalsBoot'
import { useApprovalsStore } from '../src/components/Approvals/approvals.store'
import { ApprovalsHost } from '../src/components/Approvals/ApprovalsHost'
import type { ApprovalsApi } from '../shared/types/approvals'
import { createApprovalsMock, installApprovalsMock } from '../src/components/Approvals/approvalsMock'

/** F18 · what loads at boot: the adapter, the idle preload and the fail-safe that hands a request back to main. */

const ROOT = join(__dirname, '..')

beforeEach(() => {
  resetApprovalsApi()
  resetApprovalsBoot()
  useApprovalsStore.getState().reset()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete (window as unknown as { oxe?: unknown }).oxe
})

function spyApi() {
  const mock = createApprovalsMock()
  const respond = vi.spyOn(mock, 'respond')
  const unavailable = vi.spyOn(mock, 'unavailable')
  return { mock, respond, unavailable }
}

describe('approvals adapter', () => {
  it('uses window.oxe.approvals when the preload exposes the whole surface; without it, a channel that never asks', async () => {
    expect(realApprovalsApi()).toBeNull()
    const fallback = approvalsApi()
    expect(await fallback.list()).toEqual([])
    expect(await fallback.respond({ id: 'x', optionId: 'allow', generation: 1 })).toMatchObject({ ok: false, refusal: 'notPending' })
    expect(window.__oxeApprovalsMock).toBeUndefined()
    expect(approvalsApi()).toBe(fallback)

    resetApprovalsApi()
    const real: ApprovalsApi = { list: vi.fn(), respond: vi.fn(), ack: vi.fn(), history: vi.fn(), unavailable: vi.fn(), onRequested: vi.fn(), onResolved: vi.fn() }
    ;(window as unknown as { oxe: unknown }).oxe = { approvals: real }
    expect(approvalsApi()).toBe(real)

    resetApprovalsApi()
    ;(window as unknown as { oxe: unknown }).oxe = { approvals: { list: vi.fn() } }
    expect(realApprovalsApi()).toBeNull()
    expect(approvalsApi()).not.toBe(real)

    resetApprovalsApi()
    const mock = installApprovalsMock()
    expect(approvalsApi()).toBe(mock)
    expect(window.__oxeApprovalsMock).toBe(mock.hook)
  })

  it('the mock answers with typed results like main: stale, unknown, repeated', async () => {
    const { mock } = spyApi()
    const id = mock.hook.request({ id: 'm' })
    expect(await mock.respond({ id, optionId: 'deny', generation: 9 })).toMatchObject({ ok: false, refusal: 'staleGeneration', message: { code: 'approvals.refused.staleGeneration' } })
    expect(await mock.respond({ id, optionId: 'nope', generation: 1 })).toMatchObject({ ok: false, refusal: 'unknownOption' })
    expect(await mock.unavailable({ id, generation: 1 })).toEqual({ ok: true, id })
    expect(await mock.unavailable({ id, generation: 1 })).toMatchObject({ ok: false, refusal: 'alreadyReported' })
    expect(await mock.respond({ id, optionId: 'deny', generation: 1 })).toEqual({ ok: true, id })
    expect(await mock.respond({ id, optionId: 'deny', generation: 1 })).toMatchObject({ ok: false, refusal: 'alreadyAnswered' })
    expect(await mock.respond({ id: 'gone', optionId: 'deny', generation: 1 })).toMatchObject({ ok: false, refusal: 'notPending' })
  })
})

describe('approvals at boot', () => {
  it('preloads the approval window when the renderer is idle', async () => {
    const importer = vi.fn(async () => ({}) as CenterModule)
    resetApprovalsBoot(importer)
    const idle: Array<() => void> = []
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => { idle.push(callback); return 1 })
    vi.stubGlobal('cancelIdleCallback', vi.fn())
    schedulePreload()
    expect(importer).not.toHaveBeenCalled()
    idle.forEach(run => run())
    expect(importer).toHaveBeenCalledTimes(1)
  })

  it('falls back to a timer when requestIdleCallback is missing', () => {
    vi.useFakeTimers()
    const importer = vi.fn(async () => ({}) as CenterModule)
    resetApprovalsBoot(importer)
    vi.stubGlobal('requestIdleCallback', undefined)
    schedulePreload()
    vi.advanceTimersByTime(PRELOAD_FALLBACK_MS - 1)
    expect(importer).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(importer).toHaveBeenCalledTimes(1)
  })

  it('a failed import sends approvals.unavailable exactly once for the request, and nothing else', async () => {
    resetApprovalsBoot(() => Promise.reject(new Error('chunk failed')))
    const { mock, respond, unavailable } = spyApi()
    const stop = startApprovals({ api: mock, onReady: vi.fn() })
    const id = mock.hook.request({ id: 'fail', generation: 3 })
    await waitFor(() => expect(unavailable).toHaveBeenCalledTimes(1))
    expect(unavailable).toHaveBeenCalledWith({ id, generation: 3 })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(unavailable).toHaveBeenCalledTimes(1)
    expect(respond).not.toHaveBeenCalled()
    stop()
  })

  it('a window that never shows the request sends approvals.unavailable once after the timeout, and nothing else', async () => {
    vi.useFakeTimers()
    resetApprovalsBoot(async () => ({}) as CenterModule)
    const { mock, respond, unavailable } = spyApi()
    const onReady = vi.fn()
    const stop = startApprovals({ api: mock, onReady })
    mock.hook.request({ id: 'never' })
    await vi.advanceTimersByTimeAsync(SHOW_TIMEOUT_MS - 1)
    expect(unavailable).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(unavailable).toHaveBeenCalledTimes(1)
    expect(unavailable).toHaveBeenCalledWith({ id: 'never', generation: 1 })
    await vi.advanceTimersByTimeAsync(SHOW_TIMEOUT_MS * 3)
    expect(unavailable).toHaveBeenCalledTimes(1)
    expect(respond).not.toHaveBeenCalled()
    expect(onReady).toHaveBeenCalled()
    stop()
  })

  it('mounts the approval window from its own chunk when a request arrives; once shown, the fail-safe stays quiet', async () => {
    const unavailable = vi.spyOn(installApprovalsMock(), 'unavailable')
    render(<ApprovalsHost />)
    expect(screen.queryByTestId('approval-dialog')).toBeNull()
    act(() => { window.__oxeApprovalsMock?.request({ id: 'live' }) })
    expect(await screen.findByTestId('approval-dialog', {}, { timeout: 15_000 })).toBeInTheDocument()
    await new Promise(resolve => setTimeout(resolve, SHOW_TIMEOUT_MS + 200))
    expect(unavailable).not.toHaveBeenCalled()
    expect(window.__oxeApprovalsMock?.responses).toEqual([])
  }, 30_000)
})

describe('approvals guard (no native dialog for a request while the window is open)', () => {
  const files = readdirSync(join(ROOT, 'src', 'components', 'Approvals')).map(name => [name, readFileSync(join(ROOT, 'src', 'components', 'Approvals', name), 'utf8')] as const)

  it('the window mounts the approvals host at boot', () => {
    const main = readFileSync(join(ROOT, 'src', 'main.tsx'), 'utf8')
    expect(main).toMatch(/import \{ ApprovalsHost \} from '\.\/components\/Approvals\/ApprovalsHost'/)
    expect(main).toMatch(/<ApprovalsHost \/>/)
  })

  it('the approval code never falls back to a native or browser dialog, never renders HTML and has no approve-all', () => {
    for (const [name, source] of files) {
      expect(source, name).not.toMatch(/showMessageBox|window\.confirm|window\.alert|\balert\(|dangerouslySetInnerHTML|innerHTML/)
      expect(source, name).not.toMatch(/approveAll|allowAll|approve all/i)
    }
  })

  it('the boot path imports the window lazily, never statically', () => {
    const host = files.find(([name]) => name === 'ApprovalsHost.tsx')?.[1] ?? ''
    const boot = files.find(([name]) => name === 'approvalsBoot.ts')?.[1] ?? ''
    expect(host).not.toMatch(/from '\.\/ApprovalCenter'|from '\.\/ApprovalDialog'|from '\.\/approvals\.store'/)
    expect(boot).not.toMatch(/^import [^t].*from '\.\/ApprovalCenter'/m)
    expect(boot).toMatch(/import\('\.\/ApprovalCenter'\)/)
  })

  it('every key the window builds from a request has words in English and Portuguese', () => {
    const lookup = (catalog: unknown, key: string): unknown => key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalog)
    const keys = [
      ...(['low', 'medium', 'high', 'critical'] as const).map(risk => `approvals.risk.${risk}`),
      ...(['agent', 'mcp-server', 'app'] as const).map(kind => `approvals.requester.${kind}`),
      ...(['local', 'dev', 'prod'] as const).map(kind => `approvals.environment.kind.${kind}`),
      ...(['timeout', 'cancelled', 'native'] as const).flatMap(by => [`approvals.settled.${by}`, `approvals.by.${by}`]),
      ...(['deny', 'allow', 'allow-session'] as const).map(intent => `approvals.outcome.${intent}`),
      'approvals.by.refused', 'approvals.requester.unknown', 'approvals.hold.waiting', 'approvals.hold.ready', 'approvals.hold.readyEnter'
    ]
    for (const catalog of [en, ptBR]) for (const key of keys) expect(typeof lookup(catalog, key), key).toBe('string')
  })
})
