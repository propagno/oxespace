import type { Page } from '@playwright/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { armInputTimer, armInputTimerUntil, readInputTimer, WORKSPACE_LAUNCH_DONE_CHECKS } from '../../e2e/helpers/input-timer'

function createDomPage(): { page: Page; stepFrame: () => void } {
  let nextFrameId = 1
  const frames = new Map<number, FrameRequestCallback>()

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextFrameId++
    frames.set(id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id)
  })

  const page = {
    evaluate: async <R, A>(fn: (arg: A) => R, arg?: A): Promise<R> => fn(arg as A),
    waitForFunction: async (fn: () => unknown): Promise<void> => {
      for (let i = 0; i < 10 && !fn(); i++) stepFrame()
      if (!fn()) throw new Error('waitForFunction condition did not become true')
    }
  } as unknown as Page

  const stepFrame = (): void => {
    const pending = [...frames.entries()]
    frames.clear()
    for (const [, cb] of pending) cb(performance.now())
  }

  return { page, stepFrame }
}

function setBox(el: Element, width: number, height: number): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({})
    })
  })
}

function dispatchPointerDown(target: EventTarget, timeStamp: number): void {
  const event = new Event('pointerdown', { bubbles: true })
  Object.defineProperty(event, 'timeStamp', { value: timeStamp })
  target.dispatchEvent(event)
}

describe('e2e/helpers/input-timer', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    delete (window as unknown as { __oxeInputTimer?: unknown }).__oxeInputTimer
  })

  afterEach(() => {
    const timer = (window as unknown as { __oxeInputTimer?: { stop?: () => void } }).__oxeInputTimer
    timer?.stop?.()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('waits for modal close, visible grid, and visible terminal-pane with non-zero box', async () => {
    let now = 100
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const { page, stepFrame } = createDomPage()

    const launchBtn = document.createElement('button')
    launchBtn.dataset.testid = 'wizard-launch-btn'
    document.body.appendChild(launchBtn)

    await armInputTimerUntil(page, WORKSPACE_LAUNCH_DONE_CHECKS)
    dispatchPointerDown(launchBtn, 120)

    // Hidden / zero-sized grid & pane must not stop the timer.
    const host = document.createElement('div')
    host.className = 'workspace-host'
    const grid = document.createElement('div')
    grid.dataset.testid = 'workspace-grid'
    setBox(grid, 0, 0)
    const pane = document.createElement('div')
    pane.dataset.testid = 'terminal-pane'
    setBox(pane, 0, 0)
    grid.appendChild(pane)
    host.appendChild(grid)
    document.body.appendChild(host)

    now = 180
    stepFrame()
    expect((window as unknown as { __oxeInputTimer: { done: number | null } }).__oxeInputTimer.done).toBeNull()

    // Grid gets layout, modal closes, but terminal-pane is still display:none → must not finish.
    setBox(grid, 1200, 800)
    pane.style.display = 'none'
    setBox(pane, 600, 400)
    launchBtn.remove()

    now = 210
    stepFrame()
    expect((window as unknown as { __oxeInputTimer: { done: number | null } }).__oxeInputTimer.done).toBeNull()

    // Pane switches to visibility:hidden → still must not finish.
    pane.style.display = 'block'
    pane.style.visibility = 'hidden'
    now = 240
    stepFrame()
    expect((window as unknown as { __oxeInputTimer: { done: number | null } }).__oxeInputTimer.done).toBeNull()

    // Pane becomes visible with non-zero dimensions → timer stops at this frame.
    pane.style.visibility = 'visible'
    now = 370
    stepFrame()

    await expect(readInputTimer(page)).resolves.toBe(250)
  })

  it('does not trigger early when a prior workspace is already visible behind the modal', async () => {
    let now = 500
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const { page, stepFrame } = createDomPage()

    // Existing workspace visible behind NewWorkspaceModal.
    const prevHost = document.createElement('div')
    prevHost.className = 'workspace-host'
    const prevGrid = document.createElement('div')
    prevGrid.dataset.testid = 'workspace-split-grid'
    setBox(prevGrid, 1200, 800)
    const prevPane = document.createElement('div')
    prevPane.dataset.testid = 'terminal-pane'
    setBox(prevPane, 1200, 800)
    prevGrid.appendChild(prevPane)
    prevHost.appendChild(prevGrid)
    document.body.appendChild(prevHost)

    const launchBtn = document.createElement('button')
    launchBtn.dataset.testid = 'wizard-launch-btn'
    document.body.appendChild(launchBtn)

    await armInputTimerUntil(page, WORKSPACE_LAUNCH_DONE_CHECKS)
    dispatchPointerDown(launchBtn, 510)

    // Still submitting: previous grid is visible, but wizard-launch-btn is still in DOM.
    now = 600
    stepFrame()
    expect((window as unknown as { __oxeInputTimer: { done: number | null } }).__oxeInputTimer.done).toBeNull()

    // Previous host becomes hidden, new host mounts, modal closes.
    prevHost.className = 'workspace-host workspace-host-hidden'
    prevHost.style.visibility = 'hidden'
    const nextHost = document.createElement('div')
    nextHost.className = 'workspace-host'
    const nextGrid = document.createElement('div')
    nextGrid.dataset.testid = 'workspace-split-grid'
    setBox(nextGrid, 1200, 800)
    const nextPane = document.createElement('div')
    nextPane.dataset.testid = 'terminal-pane'
    setBox(nextPane, 1200, 800)
    nextGrid.appendChild(nextPane)
    nextHost.appendChild(nextGrid)
    document.body.appendChild(nextHost)
    launchBtn.remove()

    now = 835
    stepFrame()
    await expect(readInputTimer(page)).resolves.toBe(325)
  })

  it('preserves presence-only semantics for callers that do not set visible', async () => {
    let now = 50
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const { page, stepFrame } = createDomPage()

    await armInputTimer(page, '[data-testid="panel"]', true)
    dispatchPointerDown(document.body, 60)

    const panel = document.createElement('div')
    panel.dataset.testid = 'panel'
    setBox(panel, 0, 0)
    document.body.appendChild(panel)

    now = 95
    stepFrame()
    await expect(readInputTimer(page)).resolves.toBe(35)
  })
})
