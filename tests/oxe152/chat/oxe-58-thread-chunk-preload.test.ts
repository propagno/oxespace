// Frozen acceptance test for 1.5.2 OxeChat (OXE program oxespace-152-chat, phase F1, Jira OXE-58). Written by the
// planner; the executor must not edit it. Spec: .oxe/alm/specs/OXE-58.md (CA-4, RT-3) and the 14/11 coordinator
// decision T2' (T2, the shell while a switch is pending, is dropped: the F7.2 rule stays).
//
// Contract (T2', the Thread chunk warmed on a fresh profile):
// - src/lib/idlePreload.ts: runIdlePreload(cancelled, { recent?, env?, loaders? }) — on a fresh profile (no
//   'oxe.recent-view' stored, recentView() === null) the targets include 'thread' as well as 'settings', so the real
//   loader runs VIEW_CHUNKS.thread.load() from src/components/Navigation/ModeViews.tsx. The machine checks that hold a
//   recent view back (below 8 GB deviceMemory, unknown memory, on battery, heap over 70%) hold it back here too; a
//   stored recent view keeps today's behaviour.
// - Nothing on the boot path: importing ModeViews and mounting useModeActions (App.tsx's hook, which schedules the
//   preload with scheduleIdle from src/lib/preloadSchedule.ts) does not start the Thread chunk; only the idle task does,
//   after the first paint (OXE-105, RT-3: no new weight on the boot path).
// - tests/idle-preload.test.ts asserts `preloadTargets(null, big).targets` is ['settings']: that line changes with T2'.
import { act, cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runIdlePreload, type PreloadEnvironment, type PreloadTarget } from '../../../src/lib/idlePreload'
import { useModeActions, VIEW_CHUNKS } from '../../../src/components/Navigation/ModeViews'

// The other idle targets and the palette bridges stay out of this test's way: only the Thread chunk is watched.
vi.mock('../../../src/components/Settings/SettingsHost', () => ({ preloadSettings: vi.fn(async () => undefined) }))
vi.mock('../../../src/components/Workspace/usageChunk', () => ({ USAGE_CHUNK: { load: vi.fn(async () => ({})), get: () => undefined } }))
vi.mock('../../../src/components/OxeQuery/oxequery-bridge', () => ({ onOxeQueryAction: () => () => {}, performOxeQueryAction: vi.fn() }))
vi.mock('../../../src/components/OxeQuery/oxequery.commands', () => ({}))

const big: PreloadEnvironment = { navigator: { deviceMemory: 8, getBattery: async () => ({ charging: true }) }, performance: { memory: { usedJSHeapSize: 50, jsHeapSizeLimit: 1000 } } }
const settingsOnly = () => {
  const calls: PreloadTarget[] = []
  return { calls, loaders: { settings: () => { calls.push('settings'); return Promise.resolve() } } }
}
let threadLoad: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  localStorage.clear()
  // The chunk's real load is watched, not run: ThreadSidebar and ThreadGrid are not needed to see it was asked for.
  threadLoad = vi.spyOn(VIEW_CHUNKS.thread, 'load').mockResolvedValue([] as never)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })

describe("T2' · a fresh profile warms the OxeChat chunk at idle", () => {
  it('with no recent view stored, the idle preload loads the Thread view chunk as well as Settings', async () => {
    const { calls, loaders } = settingsOnly()
    const loaded = await runIdlePreload(() => false, { env: big, loaders })
    expect(threadLoad).toHaveBeenCalledTimes(1)
    expect(loaded).toHaveLength(2)
    expect(loaded).toEqual(expect.arrayContaining(['thread', 'settings']))
    expect(calls).toEqual(['settings'])
  })

  it('the machine checks still hold it back: below 8 GB, unknown memory or on battery, only Settings loads', async () => {
    const machines: PreloadEnvironment[] = [
      { ...big, navigator: { ...big.navigator, deviceMemory: 4 } },
      { ...big, navigator: { getBattery: big.navigator!.getBattery } },
      { ...big, navigator: { ...big.navigator, getBattery: async () => ({ charging: false }) } }
    ]
    for (const env of machines) {
      const { calls, loaders } = settingsOnly()
      expect(await runIdlePreload(() => false, { env, loaders })).toEqual(['settings'])
      expect(calls).toEqual(['settings'])
    }
    expect(threadLoad).not.toHaveBeenCalled()
  })
})

describe("T2' · nothing on the boot path", () => {
  it('importing the views and mounting the app hook start no Thread chunk; the idle task, after the first paint, does', async () => {
    const idle: Array<() => void> = []
    vi.stubGlobal('requestIdleCallback', vi.fn((task: () => void) => { idle.push(task); return idle.length }))
    vi.stubGlobal('cancelIdleCallback', vi.fn())
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 8 })
    try {
      function App() { useModeActions(() => undefined); return null }
      render(createElement(App))
      await act(async () => { await Promise.resolve() })
      expect(threadLoad).not.toHaveBeenCalled()
      expect(VIEW_CHUNKS.thread.get()).toBeUndefined()
      expect(idle).toHaveLength(1)
      await act(async () => { idle[0]() })
      await vi.waitFor(() => expect(threadLoad).toHaveBeenCalledTimes(1))
    } finally { delete (navigator as { deviceMemory?: number }).deviceMemory }
  })
})
