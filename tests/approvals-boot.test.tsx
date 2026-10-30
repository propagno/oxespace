import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '../shared/locales/en/common.json'
import ptBR from '../shared/locales/pt-BR/common.json'
import { approvalsApi, realApprovalsApi, refusalOf, resetApprovalsApi } from '../src/components/Approvals/approvalsApi'
import { PRELOAD_FALLBACK_MS, resetApprovalsBoot, schedulePreload, SHOW_TIMEOUT_MS, startApprovals, type CenterModule } from '../src/components/Approvals/approvalsBoot'
import { useApprovalsStore } from '../src/components/Approvals/approvals.store'
import { ApprovalsHost } from '../src/components/Approvals/ApprovalsHost'
import { APPROVAL_KINDS, ApprovalError, type ApprovalCodeParams, type ApprovalsApi } from '../src/components/Approvals/approvalsContract'
import { createApprovalsMock } from '../src/components/Approvals/approvalsMock'

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
  it('uses window.oxe.approvals when main exposes the whole surface, and the mock (with its hook) otherwise', () => {
    expect(realApprovalsApi()).toBeNull()
    const fromMock = approvalsApi()
    expect(window.__oxeApprovalsMock).toBeDefined()
    expect(approvalsApi()).toBe(fromMock)

    resetApprovalsApi()
    const real: ApprovalsApi = { list: vi.fn(), respond: vi.fn(), history: vi.fn(), unavailable: vi.fn(), onRequested: vi.fn(), onResolved: vi.fn() }
    ;(window as unknown as { oxe: unknown }).oxe = { approvals: real }
    expect(approvalsApi()).toBe(real)
    expect(window.__oxeApprovalsMock).toBeUndefined()

    resetApprovalsApi()
    ;(window as unknown as { oxe: unknown }).oxe = { approvals: { list: vi.fn() } }
    expect(realApprovalsApi()).toBeNull()
    expect(approvalsApi()).not.toBe(real)
  })

  it('reads the C3 refusal code from a typed error and from Electron’s IPC wrapper', () => {
    expect(refusalOf(new ApprovalError('approvals.stale'))).toBe('approvals.stale')
    expect(refusalOf(new Error("Error invoking remote method 'approvals:respond': Error: approvals.notFound"))).toBe('approvals.notFound')
    expect(refusalOf({ code: 'approvals.invalidOption' })).toBe('approvals.invalidOption')
    expect(refusalOf(new Error('ECONNRESET'))).toBeNull()
  })

  it('the mock refuses stale generations and unknown options like main', async () => {
    const { mock } = spyApi()
    const id = mock.hook.request({ id: 'm' })
    await expect(mock.respond({ id, optionId: 'deny', generation: 9 })).rejects.toMatchObject({ code: 'approvals.stale' })
    await expect(mock.respond({ id, optionId: 'nope', generation: 1 })).rejects.toMatchObject({ code: 'approvals.invalidOption' })
    await expect(mock.respond({ id: 'gone', optionId: 'deny', generation: 1 })).rejects.toMatchObject({ code: 'approvals.notFound' })
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
    approvalsApi()
    const unavailable = vi.spyOn(approvalsApi(), 'unavailable')
    render(<ApprovalsHost />)
    expect(screen.queryByTestId('approval-dialog')).toBeNull()
    act(() => { window.__oxeApprovalsMock?.request({ id: 'live' }) })
    expect(await screen.findByTestId('approval-dialog', {}, { timeout: 5_000 })).toBeInTheDocument()
    await new Promise(resolve => setTimeout(resolve, SHOW_TIMEOUT_MS + 200))
    expect(unavailable).not.toHaveBeenCalled()
    expect(window.__oxeApprovalsMock?.responses).toEqual([])
  }, 15_000)
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

  it('every kind and every local code has words in English and Portuguese', () => {
    // Exhaustive: a code added to the contract without words fails to compile here.
    const all: Record<keyof ApprovalCodeParams, true> = { 'approvals.option.deny': true, 'approvals.option.allowOnce': true, 'approvals.option.allowSession': true, 'approvals.option.restart': true, 'approvals.option.closeTab': true, 'approvals.note.production': true, 'approvals.note.destructive': true, 'approvals.note.outsideWorkspace': true, 'approvals.note.crashed': true, 'approvals.notFound': true, 'approvals.stale': true, 'approvals.invalidOption': true, 'approvals.unavailable': true }
    const codes = Object.keys(all)
    const lookup = (catalog: unknown, key: string): unknown => key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalog)
    for (const catalog of [en, ptBR]) {
      for (const kind of APPROVAL_KINDS) {
        expect(typeof lookup(catalog, `approvals.title.${kind}`)).toBe('string')
        expect(typeof lookup(catalog, `approvals.kind.${kind}`)).toBe('string')
      }
      for (const code of codes) expect(typeof lookup(catalog, `approvals.codes.${code}`), code).toBe('string')
    }
  })
})
