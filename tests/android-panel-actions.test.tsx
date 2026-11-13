// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import '../src/i18n'
import { AndroidPanel } from '../src/components/Android/AndroidPanel'
import { useUIStore } from '../src/store/ui.store'
import { Toaster } from '../src/ui/Toast'

type Outcome = { ok: true } | { ok: false; reason: string }
function mockAndroid(options: { phoneApp?: 'debug' | 'release' | 'absent'; install?: Outcome; link?: Outcome; pair?: Outcome } = {}) {
  const device = { serial: 'emulator-5554', name: 'Pixel 8', kind: 'emulator', api: 36, state: 'device', agentsCanSee: false, stream: 'live', ...(options.phoneApp ? { phoneApp: options.phoneApp } : {}) }
  const android = {
    status: vi.fn(async () => ({ adb: 'ok', devices: [device], avds: [] })), onChanged: vi.fn(() => () => undefined), onFrame: vi.fn(() => () => undefined),
    connect: vi.fn(async () => ({ ok: true })), disconnect: vi.fn(async () => undefined), tap: vi.fn(async () => undefined), swipe: vi.fn(async () => undefined), key: vi.fn(async () => undefined),
    rotate: vi.fn(async () => undefined), screenshot: vi.fn(async () => ({ path: 'x', name: 'x.png' })), setAgentsCanSee: vi.fn(async () => undefined), startEmulator: vi.fn(async () => undefined),
    pickApk: vi.fn(async () => ({ id: 'pick-1', name: 'app-debug.apk', sizeBytes: 5_242_880 }) as { id: string; name: string; sizeBytes: number } | null),
    installApk: vi.fn(async () => options.install ?? { ok: true }), openLink: vi.fn(async () => options.link ?? { ok: true }), pair: vi.fn(async () => options.pair ?? { ok: true })
  }
  Object.assign(window, { oxe: { android, featureUsage: { record: async () => undefined } } })
  return android
}
async function open() {
  render(<><AndroidPanel /><Toaster /></>)
  await screen.findByRole('button', { name: 'Install an APK…' })
}

afterEach(() => { cleanup(); delete (window as { oxe?: unknown }).oxe })

describe('the Android panel\'s own actions', () => {
  test('install: the file is picked, the question names the file and the device, and only yes installs', async () => {
    const android = mockAndroid()
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Install an APK…' }))
    const dialog = await screen.findByTestId('android-install-confirm')
    expect(android.pickApk).toHaveBeenCalledWith({ serial: 'emulator-5554' })
    expect(dialog).toHaveTextContent('app-debug.apk (5.0 MB) will be installed on Pixel 8 · Emulator · API 36, serial emulator-5554')
    expect(android.installApk).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Install' }))
    await waitFor(() => expect(android.installApk).toHaveBeenCalledWith({ serial: 'emulator-5554', id: 'pick-1' }))
    expect(await screen.findByText('Installed app-debug.apk')).toBeInTheDocument()
    expect(screen.queryByTestId('android-install-confirm')).toBeNull()
  })

  test('install: cancelling the file dialog or the question installs nothing; a refusal reads in the device\'s words', async () => {
    const android = mockAndroid({ install: { ok: false, reason: 'INSTALL_FAILED_INSUFFICIENT_STORAGE' } })
    android.pickApk.mockResolvedValueOnce(null)
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Install an APK…' }))
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByTestId('android-install-confirm')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Install an APK…' }))
    fireEvent.click(within(await screen.findByTestId('android-install-confirm')).getByRole('button', { name: 'Cancel' }))
    expect(android.installApk).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Install an APK…' }))
    fireEvent.click(within(await screen.findByTestId('android-install-confirm')).getByRole('button', { name: 'Install' }))
    expect(await screen.findByText("Couldn't install app-debug.apk")).toBeInTheDocument()
    expect(screen.getByText('INSTALL_FAILED_INSUFFICIENT_STORAGE')).toBeInTheDocument()
  })

  test('open a link: an address that can\'t be sent says why and keeps Open off; a good one is sent as typed', async () => {
    const android = mockAndroid()
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Open a link…' }))
    const dialog = await screen.findByTestId('android-open-link')
    const field = within(dialog).getByLabelText('Address')
    const openButton = within(dialog).getByRole('button', { name: 'Open' })
    expect(openButton).toBeDisabled()
    fireEvent.change(field, { target: { value: 'example.com' } })
    expect(within(dialog).getByText('Start the address with http:// or https://.')).toBeInTheDocument()
    fireEvent.change(field, { target: { value: 'https://example.com/a b' } })
    expect(within(dialog).getByText(/can't be sent to the device/)).toBeInTheDocument()
    expect(openButton).toBeDisabled()
    fireEvent.change(field, { target: { value: ' https://example.com/cart?id=7&tab=2 ' } })
    expect(openButton).toBeEnabled()
    fireEvent.click(openButton)
    await waitFor(() => expect(android.openLink).toHaveBeenCalledWith({ serial: 'emulator-5554', url: 'https://example.com/cart?id=7&tab=2' }))
    expect(await screen.findByText('Sent to the device')).toBeInTheDocument()
    expect(screen.queryByTestId('android-open-link')).toBeNull()
  })

  test('pair: offered only when the phone app on the device is a debug build', async () => {
    for (const phoneApp of ['release', 'absent', undefined] as const) {
      mockAndroid(phoneApp ? { phoneApp } : {})
      await open()
      expect(screen.queryByRole('button', { name: 'Pair this device with OXESpace' })).toBeNull()
      cleanup()
    }
    const android = mockAndroid({ phoneApp: 'debug' })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Pair this device with OXESpace' }))
    await waitFor(() => expect(android.pair).toHaveBeenCalledWith({ serial: 'emulator-5554' }))
    expect(await screen.findByText('Pairing link sent')).toBeInTheDocument()
  })

  test('pair: with phone connections off, it says so and offers the settings page', async () => {
    mockAndroid({ phoneApp: 'debug', pair: { ok: false, reason: 'pairing-closed:Turn the gateway on first' } })
    const openSettingsPage = vi.fn()
    useUIStore.setState({ openSettingsPage })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Pair this device with OXESpace' }))
    expect(await screen.findByText("Phones can't connect yet")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Phone and devices' }))
    expect(openSettingsPage).toHaveBeenCalledWith('devices')
  })
})
