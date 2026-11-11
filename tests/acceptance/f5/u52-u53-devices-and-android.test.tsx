// Frozen acceptance test for 1.5.0 A51 and A52 on screen (DESIGN U5.2 and U5.3, OXE program, phase F5, tasks FE-B2 and
// FE-B3). Written by the planner; the executor must not edit it. Spec: .claude/roadmap-1.4/team/plans/1.5.0-f5-design.md.
// Contract (BACKEND #711 @ ac13dfec, §Contract):
// - shared/preview-devices.ts exports PREVIEW_DEVICES (desktop first, with null width and height; then pixel-8, iphone-15,
//   galaxy-s23, ipad-mini, each { id, name, width, height, dpr, ua, touch }) and emulationFor(device, rotated);
//   window.oxe.browserPreview.setDevice({ ownerKey, tabId, deviceId | null, rotated }).
// - window.oxe.android.{ status() → { adb: 'missing' | 'ok', devices: [{ serial, name, kind, api?, state, agentsCanSee }],
//   avds } (each device also carries stream: 'idle' | 'connecting' | 'live', main's stream state), onChanged(cb), connect({ serial }), disconnect({ serial }), onFrame(cb({ serial, width, height, data })),
//   tap({ serial, x, y }), swipe(...), key(...), rotate({ serial }), screenshot({ serial }) → { path, name },
//   setAgentsCanSee({ serial, value }), startEmulator(avd) }.
// The renderer parts: DeviceMenu({ ownerKey, tabId, deviceId, rotated }) and fitDeviceFrame(device, rotated, panel) in
// src/components/WebPreview/DeviceMenu.tsx; AndroidPanel() in src/components/Android/AndroidPanel.tsx.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'

type Device = { id: string; name: string; width: number | null; height: number | null; dpr: number; ua: string; touch: boolean }
async function load<T>(rel: string): Promise<T> {
  const file = ['.tsx', '.ts'].map(ext => join(process.cwd(), `${rel}${ext}`)).find(candidate => existsSync(candidate))
  if (!file) throw new Error(`${rel} does not exist yet`)
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('U5.2 · device emulation', () => {
  test('the shared presets are Desktop, then Pixel 8, iPhone 15, Galaxy S23 and iPad mini at their CSS sizes, with touch', async () => {
    const { PREVIEW_DEVICES } = await load<{ PREVIEW_DEVICES: Device[] }>('shared/preview-devices')
    expect(PREVIEW_DEVICES[0]).toMatchObject({ id: 'desktop', width: null, height: null })
    const DEVICE_PRESETS = PREVIEW_DEVICES.slice(1)
    expect(DEVICE_PRESETS.map(device => [device.name, device.width, device.height, device.touch])).toEqual([
      ['Pixel 8', 412, 915, true], ['iPhone 15', 393, 852, true], ['Galaxy S23', 360, 780, true], ['iPad mini', 744, 1133, true]
    ])
    for (const device of DEVICE_PRESETS) expect(device.ua).toMatch(/Mobile|iPad|Android/)
  })

  test('the device menu lists Desktop and each device with its size, sets it through main, and Rotate swaps the size', async () => {
    const browserPreview = { setDevice: vi.fn(async () => undefined) }
    Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, browserPreview } })
    const { DeviceMenu } = await load<{ DeviceMenu: (props: { ownerKey: string; tabId: string; deviceId: string | null; rotated: boolean }) => JSX.Element }>('src/components/WebPreview/DeviceMenu')
    const { rerender } = render(<DeviceMenu ownerKey="code:ws-1" tabId="tab-1" deviceId={null} rotated={false} />)
    await userEvent.click(screen.getByRole('button', { name: /Desktop/ }))
    const items = (await screen.findAllByRole('menuitemradio')).map(item => item.textContent?.replace(/\s+/g, ' ').trim())
    expect(items[0]).toMatch(/^Desktop/)
    expect(items.slice(1)).toEqual([expect.stringMatching(/Pixel 8.*412 × 915.*touch/), expect.stringMatching(/iPhone 15.*393 × 852/), expect.stringMatching(/Galaxy S23.*360 × 780/), expect.stringMatching(/iPad mini.*744 × 1133/)])
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Pixel 8/ }))
    expect(browserPreview.setDevice).toHaveBeenCalledWith({ ownerKey: 'code:ws-1', tabId: 'tab-1', deviceId: 'pixel-8', rotated: false })
    rerender(<DeviceMenu ownerKey="code:ws-1" tabId="tab-1" deviceId="pixel-8" rotated={false} />)
    expect(screen.getByText(/Pixel 8 · 412 × 915/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Rotate' }))
    expect(browserPreview.setDevice).toHaveBeenLastCalledWith({ ownerKey: 'code:ws-1', tabId: 'tab-1', deviceId: 'pixel-8', rotated: true })
    rerender(<DeviceMenu ownerKey="code:ws-1" tabId="tab-1" deviceId="pixel-8" rotated />)
    expect(screen.getByText(/Pixel 8 · 915 × 412/)).toBeInTheDocument()
  })

  test('the device frame scales to fit and never overflows the dock at 900 × 620', async () => {
    const { PREVIEW_DEVICES } = await load<{ PREVIEW_DEVICES: Device[] }>('shared/preview-devices')
    const DEVICE_PRESETS = PREVIEW_DEVICES.filter(device => device.id !== 'desktop')
    const { fitDeviceFrame } = await load<{ fitDeviceFrame: (device: Device, rotated: boolean, panel: { width: number; height: number }) => { scale: number; width: number; height: number; radius: number } }>('src/components/WebPreview/DeviceMenu')
    for (const device of DEVICE_PRESETS) for (const rotated of [false, true]) {
      const frame = fitDeviceFrame(device, rotated, { width: 420, height: 560 })
      expect(frame.width).toBeLessThanOrEqual(420)
      expect(frame.height).toBeLessThanOrEqual(560)
      expect(frame.scale).toBeGreaterThan(0)
      expect(frame.radius).toBe(device.id === 'ipad-mini' ? 20 : 28)
    }
  })
})

describe('U5.3 · the Android mirror', () => {
  type Status = Record<string, unknown>
  const pixel = { serial: 'emulator-5554', name: 'Pixel 8', kind: 'emulator', api: 36, state: 'device', agentsCanSee: false, stream: 'live' }
  function mockAndroid(status: Status) {
    let current = status
    const frames: Array<(frame: Record<string, unknown>) => void> = []
    const changed: Array<(event: unknown) => void> = []
    const android = {
      status: vi.fn(async () => current),
      onChanged: vi.fn((listener: (event: unknown) => void) => { changed.push(listener); return () => undefined }),
      connect: vi.fn(async () => ({ ok: true })),
      disconnect: vi.fn(async () => undefined),
      onFrame: vi.fn((listener: (frame: Record<string, unknown>) => void) => { frames.push(listener); return () => undefined }),
      tap: vi.fn(async () => undefined), swipe: vi.fn(async () => undefined), key: vi.fn(async () => undefined),
      rotate: vi.fn(async () => undefined),
      screenshot: vi.fn(async () => ({ path: 'C:/shots/screenshot-14-42.png', name: 'screenshot-14-42.png' })),
      setAgentsCanSee: vi.fn(async ({ value }: { value: boolean }) => { current = { ...current, devices: (current.devices as Status[]).map(device => ({ ...device, agentsCanSee: value })) } }),
      startEmulator: vi.fn(async () => undefined)
    }
    Object.assign(window, { oxe: { ...(window as unknown as { oxe?: object }).oxe, android } })
    return {
      android,
      frame: () => act(() => { for (const listener of frames) listener({ serial: 'emulator-5554', width: 1080, height: 2400, data: new Uint8Array(4) }) }),
      change: (next: Status) => { current = next; act(() => { for (const listener of changed) listener({}) }) }
    }
  }
  async function renderPanel() {
    const { AndroidPanel } = await load<{ AndroidPanel: () => JSX.Element }>('src/components/Android/AndroidPanel')
    const { Toaster } = await import('../../../src/ui/Toast')
    render(<><AndroidPanel /><Toaster /></>)
  }

  test('a connected device shows its name, Live while main streams it, and a canvas named for it', async () => {
    const main = mockAndroid({ adb: 'ok', devices: [pixel], avds: ['Pixel_8_API_36'] })
    await renderPanel()
    expect(await screen.findByRole('button', { name: /Pixel 8 · Emulator · API 36/ })).toBeInTheDocument()
    await waitFor(() => expect(main.android.connect).toHaveBeenCalledWith({ serial: 'emulator-5554' }))
    main.frame()
    expect(await screen.findByText('Live')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Pixel 8 screen, live' })).toBeInTheDocument()
  })

  test('a tap on the screen sends one tap at device coordinates, and Rotate and Screenshot go to main', async () => {
    const main = mockAndroid({ adb: 'ok', devices: [pixel], avds: [] })
    await renderPanel()
    main.frame()
    const screenEl = await screen.findByRole('img', { name: 'Pixel 8 screen, live' })
    vi.spyOn(screenEl, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 270, height: 600, right: 270, bottom: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    fireEvent.pointerDown(screenEl, { clientX: 135, clientY: 300, pointerId: 1 })
    fireEvent.pointerUp(screenEl, { clientX: 135, clientY: 300, pointerId: 1 })
    await waitFor(() => expect(main.android.tap).toHaveBeenCalledTimes(1))
    expect(main.android.tap).toHaveBeenCalledWith({ serial: 'emulator-5554', x: 540, y: 1200 })
    await userEvent.click(screen.getByRole('button', { name: 'Rotate' }))
    expect(main.android.rotate).toHaveBeenCalledWith({ serial: 'emulator-5554' })
    await userEvent.click(screen.getByRole('button', { name: 'Screenshot' }))
    expect(await screen.findByText('Saved screenshot-14-42.png')).toBeInTheDocument()
  })

  test('"Agents can see" is off by default and per device, and turning it on says agents can take screenshots', async () => {
    const main = mockAndroid({ adb: 'ok', devices: [pixel], avds: [] })
    await renderPanel()
    const toggle = await screen.findByRole('switch', { name: 'Agents can see' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(toggle)
    expect(main.android.setAgentsCanSee).toHaveBeenCalledWith({ serial: 'emulator-5554', value: true })
    expect(await screen.findByText('Agents can take screenshots of this device')).toBeInTheDocument()
  })

  test('every state reads with its copy and action', async () => {
    const cases: Array<[Status, RegExp, string | null]> = [
      [{ adb: 'missing', devices: [], avds: [] }, /Android tools not found/, 'How to install'],
      [{ adb: 'ok', devices: [], avds: ['Pixel_8_API_36'] }, /No Android device/, 'Start the Pixel 8 emulator'],
      [{ adb: 'ok', devices: [{ ...pixel, name: 'Galaxy S23', kind: 'usb', state: 'offline' }], avds: [] }, /Lost Galaxy S23/, 'Reconnect'],
      [{ adb: 'ok', devices: [{ ...pixel, kind: 'usb', state: 'unauthorized' }], avds: [] }, /USB debugging wasn't allowed/, 'Reconnect'],
      [{ adb: 'ok', devices: [{ ...pixel, kind: 'usb', state: 'authorizing' }], avds: [] }, /Waiting for Pixel 8/, null],
      [{ adb: 'ok', devices: [{ ...pixel, kind: 'usb', state: 'no-permissions' }], avds: [] }, /Can't access Pixel 8/, 'How to set it up']
    ]
    for (const [status, copy, action] of cases) {
      mockAndroid(status)
      await renderPanel()
      expect(await screen.findByText(copy)).toBeInTheDocument()
      if (action) expect(screen.getByRole('button', { name: action })).toBeInTheDocument()
      cleanup()
    }
    // Connecting comes from main's stream state, not from the connect call: it shows even after connect resolved.
    const main = mockAndroid({ adb: 'ok', devices: [{ ...pixel, stream: 'connecting' }], avds: [] })
    await renderPanel()
    expect(await screen.findByText('Connecting to Pixel 8…')).toBeInTheDocument()
    expect(screen.queryByText('Live')).toBeNull()
    main.change({ adb: 'ok', devices: [{ ...pixel, stream: 'live' }], avds: [] })
    main.frame()
    expect(await screen.findByText('Live')).toBeInTheDocument()
  })

  test('agents have no input path: the MCP tools include the device screenshot and no tap, swipe or key', async () => {
    const { MCP_COVERAGE } = await import('../../../shared/mcp-coverage')
    const entries = JSON.stringify(MCP_COVERAGE)
    expect(entries).toMatch(/oxespace_device_screenshot/)
    expect(entries).not.toMatch(/android[:.](tap|swipe|key)|oxespace_device_(tap|swipe|key|type|input)/)
  })

  test('a connected phone that leaves the list, such as an unplugged USB cable, shows Lost with its name and Reconnect', async () => {
    const galaxy = { serial: 'R5CT1', name: 'Galaxy S23', kind: 'usb', state: 'device', agentsCanSee: false, stream: 'live' }
    const main = mockAndroid({ adb: 'ok', devices: [galaxy], avds: [] })
    await renderPanel()
    expect(await screen.findByRole('button', { name: /Galaxy S23 · USB/ })).toBeInTheDocument()
    main.change({ adb: 'ok', devices: [], avds: [] })
    expect(await screen.findByText(/Lost Galaxy S23/)).toBeInTheDocument()
    expect(screen.getByText('The cable was unplugged or USB debugging turned off.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument()
  })


  test('"Agents can see" belongs to each device: turning it on for one leaves the other off', async () => {
    const galaxy = { serial: 'R5CT1', name: 'Galaxy S23', kind: 'usb', state: 'device', agentsCanSee: false, stream: 'live' }
    const main = mockAndroid({ adb: 'ok', devices: [pixel, galaxy], avds: [] })
    main.android.setAgentsCanSee.mockImplementation(async ({ serial, value }: { serial: string; value: boolean }) => {
      main.change({ adb: 'ok', devices: [{ ...pixel, agentsCanSee: serial === pixel.serial ? value : pixel.agentsCanSee }, galaxy], avds: [] })
    })
    await renderPanel()
    await userEvent.click(await screen.findByRole('switch', { name: 'Agents can see' }))
    expect(main.android.setAgentsCanSee).toHaveBeenCalledWith({ serial: 'emulator-5554', value: true })
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Agents can see' })).toHaveAttribute('aria-checked', 'true'))
    await userEvent.click(screen.getByRole('button', { name: /Pixel 8 · Emulator · API 36/ }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /Galaxy S23 · USB/ }))
    await waitFor(() => expect(main.android.connect).toHaveBeenCalledWith({ serial: 'R5CT1' }))
    expect(await screen.findByRole('switch', { name: 'Agents can see' })).toHaveAttribute('aria-checked', 'false')
    expect(main.android.setAgentsCanSee).toHaveBeenCalledTimes(1)
  })


  test('waiting on the phone says to tap Allow with no button, and no-permissions offers the udev help and Reconnect', async () => {
    mockAndroid({ adb: 'ok', devices: [{ ...pixel, kind: 'usb', state: 'authorizing' }], avds: [] })
    await renderPanel()
    expect(await screen.findByText("Tap Allow on the phone's screen.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Reconnect|How to/ })).toBeNull()
    cleanup()
    mockAndroid({ adb: 'ok', devices: [{ ...pixel, kind: 'usb', state: 'no-permissions' }], avds: [] })
    await renderPanel()
    expect(await screen.findByText('Linux needs a udev rule for this phone. Add it, then reconnect.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument()
  })

})
