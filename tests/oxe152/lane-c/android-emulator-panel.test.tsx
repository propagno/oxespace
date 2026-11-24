// @vitest-environment jsdom
// OXE-112 (part B): AndroidPanel owned vs external emulator controls and device disconnect notice.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import '../../../src/i18n'
import { AndroidPanel } from '../../../src/components/Android/AndroidPanel'
import { Toaster } from '../../../src/ui/Toast'
import type { AndroidActionOutcome, AndroidMirrorStatus } from '../../../shared/types/ipc'

function mockAndroid(initial: AndroidMirrorStatus, options: { stopResult?: AndroidActionOutcome } = {}) {
  let current = initial
  const changed: Array<(status?: AndroidMirrorStatus) => void> = []
  const android = {
    status: vi.fn(async () => current),
    onChanged: vi.fn((listener: (status?: AndroidMirrorStatus) => void) => { changed.push(listener); return () => undefined }),
    onFrame: vi.fn(() => () => undefined),
    connect: vi.fn(async () => ({ ok: true })),
    disconnect: vi.fn(async () => undefined),
    tap: vi.fn(async () => undefined),
    swipe: vi.fn(async () => undefined),
    key: vi.fn(async () => undefined),
    rotate: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => ({ path: 'x', name: 'x.png' })),
    setAgentsCanSee: vi.fn(async () => undefined),
    startEmulator: vi.fn(async () => undefined),
    pickApk: vi.fn(async () => null),
    installApk: vi.fn(async () => ({ ok: true as const })),
    openLink: vi.fn(async () => ({ ok: true as const })),
    pair: vi.fn(async () => ({ ok: true as const })),
    stopEmulator: vi.fn(async ({ serial }: { serial: string }): Promise<AndroidActionOutcome> => {
      if (options.stopResult) return options.stopResult
      current = { ...current, devices: current.devices.filter(d => d.serial !== serial) }
      return { ok: true }
    })
  }
  Object.assign(window, { oxe: { android, featureUsage: { record: async () => undefined } } })
  return {
    android,
    pushStatus: (next: AndroidMirrorStatus) => {
      current = next
      act(() => { for (const listener of changed) listener(next) })
    }
  }
}

afterEach(() => {
  cleanup()
  delete (window as { oxe?: unknown }).oxe
})

describe('OXE-112 (B) · AndroidPanel owned emulator stop control and disconnect notice', () => {
  test('an OXESpace-owned emulator shows its origin badge and Stop emulator button, which stops cleanly to the empty state', async () => {
    const { android } = mockAndroid({
      adb: 'ok',
      devices: [{ serial: 'emulator-5554', name: 'Pixel 8', kind: 'emulator', api: 36, state: 'device', agentsCanSee: false, stream: 'live', owned: true }],
      avds: ['Pixel_8_API_36']
    })

    render(<><AndroidPanel /><Toaster /></>)

    expect(await screen.findByTestId('android-emulator-origin')).toHaveTextContent('Started by OXESpace')
    const stopBtn = screen.getByRole('button', { name: 'Stop emulator' })
    fireEvent.click(stopBtn)

    await waitFor(() => expect(android.stopEmulator).toHaveBeenCalledWith({ serial: 'emulator-5554' }))
    expect(await screen.findByText('Stopped Pixel 8')).toBeInTheDocument()
    // Intentional stop returns to the clean empty state, not "Lost Pixel 8".
    expect(await screen.findByText('No Android device')).toBeInTheDocument()
    expect(screen.queryByText(/Lost Pixel 8/)).toBeNull()
  })

  test('an external emulator shows its origin badge and never renders a Stop emulator button', async () => {
    mockAndroid({
      adb: 'ok',
      devices: [{ serial: 'emulator-5556', name: 'Pixel 8', kind: 'emulator', api: 36, state: 'device', agentsCanSee: false, stream: 'live' }],
      avds: []
    })

    render(<><AndroidPanel /><Toaster /></>)

    expect(await screen.findByTestId('android-emulator-origin')).toHaveTextContent('Started outside OXESpace')
    expect(screen.queryByRole('button', { name: 'Stop emulator' })).toBeNull()
  })

  test('a physical USB device never renders Stop emulator or an emulator origin badge', async () => {
    mockAndroid({
      adb: 'ok',
      devices: [{ serial: 'R58N12345', name: 'Galaxy S23', kind: 'usb', api: 34, state: 'device', agentsCanSee: false, stream: 'live' }],
      avds: []
    })

    render(<><AndroidPanel /><Toaster /></>)

    expect(await screen.findByRole('button', { name: /Galaxy S23 · USB · API 34/ })).toBeInTheDocument()
    expect(screen.queryByTestId('android-emulator-origin')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stop emulator' })).toBeNull()
  })

  test('if stopEmulator is refused as notOwned, a danger toast explains why', async () => {
    mockAndroid(
      {
        adb: 'ok',
        devices: [{ serial: 'emulator-5554', name: 'Pixel 8', kind: 'emulator', api: 36, state: 'device', agentsCanSee: false, stream: 'live', owned: true }],
        avds: []
      },
      { stopResult: { ok: false, reason: 'android.avd.notOwned' } }
    )

    render(<><AndroidPanel /><Toaster /></>)

    fireEvent.click(await screen.findByRole('button', { name: 'Stop emulator' }))
    expect(await screen.findByText("Couldn't stop Pixel 8")).toBeInTheDocument()
    expect(screen.getByText("This emulator was started outside OXESpace and can't be stopped here.")).toBeInTheDocument()
  })

  test('when a device disconnects while another device remains, a dismissible notice banner and toast inform the user that agents were notified', async () => {
    const galaxy = { serial: 'R58N12345', name: 'Galaxy S23', kind: 'usb' as const, api: 34, state: 'device' as const, agentsCanSee: false, stream: 'live' as const }
    const pixel = { serial: 'emulator-5554', name: 'Pixel 8', kind: 'emulator' as const, api: 36, state: 'device' as const, agentsCanSee: true, stream: 'live' as const, owned: true }
    const { pushStatus } = mockAndroid({ adb: 'ok', devices: [pixel, galaxy], avds: [] })

    render(<><AndroidPanel /><Toaster /></>)
    expect(await screen.findByRole('button', { name: /Pixel 8 · Emulator · API 36/ })).toBeInTheDocument()

    pushStatus({
      adb: 'ok',
      devices: [galaxy],
      avds: [],
      disconnectedDevice: { serial: 'emulator-5554', name: 'Pixel 8', kind: 'emulator', at: 1700000001 }
    })

    const notice = await screen.findByTestId('android-disconnect-notice')
    expect(notice).toHaveAttribute('role', 'status')
    expect(notice).toHaveTextContent('Pixel 8 disconnected. Agents were notified.')
    expect(await screen.findByText('Pixel 8 disconnected')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('android-disconnect-notice')).toBeNull()
  })

  test('when the last device disconnects unexpectedly, the Lost view also notes that active agents were notified', async () => {
    const pixel = { serial: 'emulator-5554', name: 'Pixel 8', kind: 'emulator' as const, api: 36, state: 'device' as const, agentsCanSee: true, stream: 'live' as const, owned: true }
    const { pushStatus } = mockAndroid({ adb: 'ok', devices: [pixel], avds: [] })

    render(<><AndroidPanel /><Toaster /></>)
    expect(await screen.findByRole('button', { name: /Pixel 8 · Emulator · API 36/ })).toBeInTheDocument()

    pushStatus({
      adb: 'ok',
      devices: [],
      avds: [],
      disconnectedDevice: { serial: 'emulator-5554', name: 'Pixel 8', kind: 'emulator', at: 1700000002 }
    })

    expect(await screen.findByText('Lost Pixel 8')).toBeInTheDocument()
    const notes = await screen.findAllByText('Active agents were notified that this device is no longer available.')
    expect(notes.length).toBeGreaterThanOrEqual(1)
  })
})
