// Frozen acceptance test for 1.5.0 A51 / B2 (OXE program, phase F5): real device emulation from one shared device list,
// and one debugger broker per page with reference counting, so emulation and capture share the attach and capture still
// works with the debugger on; capture refuses only while DevTools is open. A fake webContents.debugger only.
// Written by the planner; the executor must not edit it.
// CCR: docs/roadmap-1.5/ccr-f5-see-agent.md §A51; DESIGN 1.5.0-f5-design.md U5.2.
import { describe, expect, test, vi } from 'vitest'
import { DebuggerBroker } from '../../../electron/main/services/browser-preview/debugger-broker'
import { emulationFor, PREVIEW_DEVICES } from '../../../shared/preview-devices'
import { messageFromError } from '../../../shared/messages'

describe('A51 · the device list', () => {
  test('A51: Desktop plus four devices, in shared/, with size, ratio, user agent and touch', () => {
    expect(PREVIEW_DEVICES.map(device => [device.id, device.width, device.height])).toEqual([
      ['desktop', null, null], ['pixel-8', 412, 915], ['iphone-15', 393, 852], ['galaxy-s23', 360, 780], ['ipad-mini', 744, 1133]
    ])
    for (const device of PREVIEW_DEVICES.slice(1)) {
      expect(device.touch, device.id).toBe(true)
      expect(device.dpr, device.id).toBeGreaterThan(1)
      expect(device.ua, device.id).toMatch(/Mobile|iPad/)
    }
  })

  test('A51: Pixel 8 emulates 412 × 915 at its ratio, mobile, with its user agent and touch; Rotate swaps the size', () => {
    const pixel = PREVIEW_DEVICES.find(device => device.id === 'pixel-8')!
    expect(emulationFor(pixel, false)).toEqual({
      deviceEmulation: { screenPosition: 'mobile', screenSize: { width: 412, height: 915 }, viewSize: { width: 412, height: 915 }, deviceScaleFactor: pixel.dpr, viewPosition: { x: 0, y: 0 }, scale: 1 },
      userAgent: pixel.ua, touch: true
    })
    expect(emulationFor(pixel, true).deviceEmulation.viewSize).toEqual({ width: 915, height: 412 })
    expect(emulationFor(PREVIEW_DEVICES[0], false)).toBeNull()
  })
})

function fakeDebugger() {
  let attached = false
  const calls: string[] = []
  return {
    calls,
    debugger: {
      attach: vi.fn(() => { if (attached) throw new Error('Another debugger is already attached'); attached = true; calls.push('attach') }),
      detach: vi.fn(() => { attached = false; calls.push('detach') }),
      isAttached: () => attached,
      sendCommand: vi.fn(async (method: string) => { calls.push(method); return method === 'Page.captureScreenshot' ? { data: 'iVBOR' } : {} }),
      on: vi.fn(), removeListener: vi.fn()
    }
  }
}

describe('A51 · the debugger broker', () => {
  test('A51: emulation and capture share one attach; it detaches only when the last user releases', async () => {
    const fake = fakeDebugger()
    const broker = new DebuggerBroker(fake.debugger as never, { devToolsOpen: () => false })
    const emulation = broker.acquire('emulation')
    const capture = broker.acquire('capture')
    expect(fake.debugger.attach).toHaveBeenCalledTimes(1)
    expect(broker.state()).toEqual({ attached: true, devToolsOpen: false, users: ['capture', 'emulation'] })
    capture.release()
    expect(fake.debugger.detach).not.toHaveBeenCalled()
    emulation.release()
    expect(fake.debugger.detach).toHaveBeenCalledTimes(1)
    expect(broker.state().attached).toBe(false)
    // A second release is harmless.
    emulation.release()
    expect(fake.debugger.detach).toHaveBeenCalledTimes(1)
  })

  test('A51: capture works while emulation holds the debugger, and returns the image', async () => {
    const fake = fakeDebugger()
    const broker = new DebuggerBroker(fake.debugger as never, { devToolsOpen: () => false })
    const emulation = broker.acquire('emulation')
    expect(await broker.capture()).toEqual({ data: 'iVBOR' })
    expect(fake.calls.filter(call => call === 'attach')).toHaveLength(1)
    expect(broker.state().attached).toBe(true)
    emulation.release()
  })

  test('A51: while DevTools is open, capture is refused with preview.capture.devtools and nothing attaches', async () => {
    const fake = fakeDebugger()
    let open = true
    const broker = new DebuggerBroker(fake.debugger as never, { devToolsOpen: () => open })
    const error = await broker.capture().then(() => null, (cause: unknown) => cause)
    expect(messageFromError(error)).toEqual({ code: 'preview.capture.devtools', params: {} })
    expect(fake.debugger.attach).not.toHaveBeenCalled()
    open = false
    expect(await broker.capture()).toEqual({ data: 'iVBOR' })
  })

  test('A51: someone else\'s attach (another debugger) is reported, not thrown through, and the broker stays usable', async () => {
    const fake = fakeDebugger()
    fake.debugger.attach.mockImplementationOnce(() => { throw new Error('Another debugger is already attached') })
    const broker = new DebuggerBroker(fake.debugger as never, { devToolsOpen: () => false })
    const error = await broker.capture().then(() => null, (cause: unknown) => cause)
    expect(messageFromError(error)).toEqual({ code: 'preview.capture.busy', params: {} })
    expect(await broker.capture()).toEqual({ data: 'iVBOR' })
  })
})
