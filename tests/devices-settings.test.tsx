import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { DevicesSettings, FIREWALL_EXPLAINED_KEY } from '../src/components/Settings/DevicesSettings'
import { PhoneWriteBadge, PhoneWriteMenuItem, usePhoneWrite } from '../src/components/Grid/PanePhoneWrite'
import { changeLanguage } from '../src/i18n'
import { formatMainMessage } from '../src/i18n/mainMessage'
import { useRemoteStore } from '../src/store/remote.store'
import { pairingUri, REMOTE_FORBIDDEN, REMOTE_LIMITS } from '../shared/remote/protocol'
import { REMOTE_DEFAULT_DESKTOP_NAME, type RemoteChange, type RemoteDevice, type RemoteGatewayStatus } from '../shared/types/remote'

const FP = '0123456789abcdef'.repeat(4)
const CODE = 'AbCdEfGhIjKlMnOpQrStUv'

function fakeRemote(options: { status?: Partial<RemoteGatewayStatus>; devices?: RemoteDevice[] } = {}) {
  let status: RemoteGatewayStatus = { enabled: false, desktopName: REMOTE_DEFAULT_DESKTOP_NAME, listening: null, fingerprint: null, devices: 0, maxDevices: REMOTE_LIMITS.maxDevices, phoneWritePanes: [], ...options.status }
  let devices = options.devices ?? []
  const listeners = new Set<(change: RemoteChange) => void>()
  const emit = (change: RemoteChange): void => { act(() => { for (const listener of listeners) listener(change) }) }
  const api = {
    status: vi.fn(async () => status),
    devices: vi.fn(async () => devices),
    onChanged: vi.fn((listener: (change: RemoteChange) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }),
    setEnabled: vi.fn(async ({ enabled }: { enabled: boolean }) => {
      status = { ...status, enabled, listening: enabled ? { addresses: ['192.168.0.10'], port: 47321 } : null, fingerprint: FP }
      return status
    }),
    startPairing: vi.fn(async () => ({ uri: pairingUri({ v: 1, host: '192.168.0.10', port: 47321, fp: FP, code: CODE, name: status.desktopName }), expiresAt: Date.now() + REMOTE_LIMITS.pairingCodeTtlMs })),
    cancelPairing: vi.fn(async () => undefined),
    answerPairing: vi.fn(async () => undefined),
    revoke: vi.fn(async ({ deviceId }: { deviceId: string }) => { devices = devices.filter(device => device.deviceId !== deviceId) }),
    rename: vi.fn(async ({ deviceId, name }: { deviceId: string; name: string }) => ({ ...devices.find(device => device.deviceId === deviceId)!, name })),
    setDesktopName: vi.fn(async ({ name }: { name: string | null }) => { status = { ...status, desktopName: name ?? REMOTE_DEFAULT_DESKTOP_NAME }; return status }),
    setPhoneWrite: vi.fn(async ({ paneId, allowed }: { paneId: string; allowed: boolean }) => {
      status = { ...status, phoneWritePanes: allowed ? [...status.phoneWritePanes, paneId] : status.phoneWritePanes.filter(id => id !== paneId) }
      return status
    })
  }
  ;(window as unknown as { oxe: unknown }).oxe = { remote: api, app: { platform: 'win32' } }
  return { api, emit }
}

const pixel: RemoteDevice = { deviceId: 'device-1', name: 'Pixel 8', pairedAt: Date.UTC(2026, 9, 1), lastSeenAt: Date.UTC(2026, 9, 29), connected: true }
const gatewaySwitch = (): HTMLElement => screen.getByRole('switch', { name: 'Let phones on this network connect' })

beforeEach(() => { useRemoteStore.setState({ status: null, devices: null, pairing: null, loadError: null }); localStorage.clear() })
afterEach(async () => { cleanup(); delete (window as { oxe?: unknown }).oxe; await changeLanguage('en') })

describe('Settings › Devices', () => {
  it('starts with the phone connection off and pairing unavailable', async () => {
    fakeRemote()
    render(<DevicesSettings />)
    expect(await screen.findByText('Off. No port is open.')).toBeInTheDocument()
    expect(gatewaySwitch()).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('button', { name: 'Show pairing code' })).toBeDisabled()
    expect(screen.getByText('Turn on the phone connection first.')).toBeInTheDocument()
    // The only switch on the page is the connection itself: nothing here widens what the phone may do.
    expect(screen.getAllByRole('switch')).toHaveLength(1)
  })

  it('explains the firewall before the first time it turns on, and not again', async () => {
    const { api } = fakeRemote()
    render(<DevicesSettings />)
    await userEvent.click(await screen.findByRole('switch'))
    let dialog = screen.getByRole('dialog', { name: 'Before phones can connect' })
    expect(dialog).toHaveTextContent('Windows will ask whether OXESpace may accept connections')
    expect(dialog).toHaveTextContent('Nothing is exposed to the internet')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(api.setEnabled).not.toHaveBeenCalled()
    expect(gatewaySwitch()).toHaveAttribute('aria-checked', 'false')

    await userEvent.click(gatewaySwitch())
    dialog = screen.getByRole('dialog', { name: 'Before phones can connect' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Turn on' }))
    expect(api.setEnabled).toHaveBeenLastCalledWith({ enabled: true })
    expect(await screen.findByText('Listening on 192.168.0.10, port 47321')).toBeInTheDocument()
    expect(localStorage.getItem(FIREWALL_EXPLAINED_KEY)).toBe('1')

    await userEvent.click(gatewaySwitch())
    expect(api.setEnabled).toHaveBeenLastCalledWith({ enabled: false })
    expect(await screen.findByText('Off. No port is open.')).toBeInTheDocument()
    await userEvent.click(gatewaySwitch())
    expect(screen.queryByRole('dialog', { name: 'Before phones can connect' })).toBeNull()
    expect(api.setEnabled).toHaveBeenLastCalledWith({ enabled: true })
  })

  it('shows the QR with its text alternative, then asks to confirm the phone by its code', async () => {
    const { api, emit } = fakeRemote({ status: { enabled: true, listening: { addresses: ['192.168.0.10'], port: 47321 }, fingerprint: FP } })
    render(<DevicesSettings />)
    await userEvent.click(await screen.findByRole('button', { name: 'Show pairing code' }))
    const qr = await screen.findByRole('img', { name: /Pairing QR code\. If the phone cannot scan it, type the address and code/ })
    expect(qr.querySelector('path')?.getAttribute('d')).toMatch(/^M\d+ \d+h1v1h-1z/)
    expect(screen.getByText('192.168.0.10:47321')).toBeInTheDocument()
    expect(screen.getByTestId('devices-pairing-code')).toHaveTextContent(CODE)
    expect(screen.getByTestId('devices-pairing-fingerprint')).toHaveTextContent('0123 4567 89AB CDEF')
    expect(screen.getByText(/Expires in [12]:\d\d/)).toBeInTheDocument()

    emit({ pairing: { promptId: 'p1', deviceName: 'Pixel 8 Pro', verification: '28T5CY', expiresAt: Date.now() + 60_000 } })
    const prompt = screen.getByRole('dialog', { name: 'Pair Pixel 8 Pro?' })
    expect(within(prompt).getByTestId('devices-pairing-verification')).toHaveTextContent('28T5CY')
    // The code was used by this attempt: it leaves the screen.
    expect(screen.queryByTestId('devices-pairing-qr')).toBeNull()
    await userEvent.click(within(prompt).getByRole('button', { name: 'Pair' }))
    expect(api.answerPairing).toHaveBeenCalledWith({ promptId: 'p1', accept: true })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Pair Pixel 8 Pro?' })).toBeNull())
  })

  it('withdraws the code when cancelled or when leaving the page', async () => {
    const { api } = fakeRemote({ status: { enabled: true, listening: { addresses: ['192.168.0.10'], port: 47321 }, fingerprint: FP } })
    const { unmount } = render(<DevicesSettings />)
    await userEvent.click(await screen.findByRole('button', { name: 'Show pairing code' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(api.cancelPairing).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('devices-pairing-qr')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Show pairing code' }))
    await screen.findByTestId('devices-pairing-qr')
    unmount()
    expect(api.cancelPairing).toHaveBeenCalledTimes(2)
  })

  it('refuses a phone whose code does not match', async () => {
    const { api, emit } = fakeRemote({ status: { enabled: true, listening: { addresses: ['192.168.0.10'], port: 47321 } } })
    render(<DevicesSettings />)
    await screen.findByRole('button', { name: 'Show pairing code' })
    emit({ pairing: { promptId: 'p2', deviceName: 'Unknown', verification: 'ZZZZZZ', expiresAt: Date.now() + 60_000 } })
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Pair Unknown?' })).getByRole('button', { name: 'Refuse' }))
    expect(api.answerPairing).toHaveBeenCalledWith({ promptId: 'p2', accept: false })
  })

  it('words a gateway error from its message code in pt-BR', async () => {
    await changeLanguage('pt-BR')
    fakeRemote({ status: { error: { code: 'remote.port.inUse', params: { port: 47321 } } } })
    render(<DevicesSettings />)
    expect(await screen.findByTestId('devices-gateway-error')).toHaveTextContent('A porta 47321 já está em uso por outro programa. Escolha outra porta.')
    expect(screen.getByRole('switch', { name: 'Permitir que celulares desta rede se conectem' })).toBeInTheDocument()
  })

  it('lists paired phones and removes one only after confirming', async () => {
    const { api } = fakeRemote({ devices: [pixel, { ...pixel, deviceId: 'device-2', name: 'Galaxy', connected: false, lastSeenAt: null }] })
    render(<DevicesSettings />)
    const list = await screen.findByRole('list', { name: 'Paired phones' })
    expect(within(list).getAllByTestId('devices-device')).toHaveLength(2)
    expect(within(list).getByRole('img', { name: 'Connected' })).toBeInTheDocument()
    expect(within(list).getByText(/Never connected/)).toBeInTheDocument()
    expect(screen.getByText('2 of 5')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Remove Pixel 8' }))
    const confirm = screen.getByRole('dialog', { name: 'Remove Pixel 8?' })
    expect(confirm).toHaveTextContent('disconnected right away')
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(api.revoke).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Remove Pixel 8' }))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Remove Pixel 8?' })).getByRole('button', { name: 'Remove' }))
    expect(api.revoke).toHaveBeenCalledWith({ deviceId: 'device-1' })
    await waitFor(() => expect(screen.queryByText('Pixel 8')).toBeNull())
    expect(screen.getAllByTestId('devices-device')).toHaveLength(1)
  })

  it('renames a paired phone', async () => {
    const { api } = fakeRemote({ devices: [pixel] })
    render(<DevicesSettings />)
    await userEvent.click(await screen.findByRole('button', { name: 'Rename Pixel 8' }))
    const field = screen.getByRole('textbox', { name: 'Phone name' })
    await userEvent.clear(field)
    await userEvent.type(field, 'Work phone')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.rename).toHaveBeenCalledWith({ deviceId: 'device-1', name: 'Work phone' })
    expect(await screen.findByText('Work phone')).toBeInTheDocument()
  })

  it('names this computer "OXESpace" until the person picks a name, and saves it through the gateway', async () => {
    const { api } = fakeRemote()
    render(<DevicesSettings />)
    const field = await screen.findByRole('textbox', { name: 'Name phones see' })
    expect(field).toHaveValue('OXESpace')
    expect(screen.getByRole('button', { name: 'Save name' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Use "OXESpace"' })).toBeNull()
    expect(api.setDesktopName).not.toHaveBeenCalled()

    await userEvent.clear(field)
    expect(screen.getByText('Type a name, or use the default.')).toBeInTheDocument()
    await userEvent.type(field, '  Studio  ')
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }))
    expect(api.setDesktopName).toHaveBeenCalledWith({ name: 'Studio' })
    await waitFor(() => expect(field).toHaveValue('Studio'))

    await userEvent.click(screen.getByRole('button', { name: 'Use "OXESpace"' }))
    expect(api.setDesktopName).toHaveBeenLastCalledWith({ name: null })
    await waitFor(() => expect(field).toHaveValue('OXESpace'))
  })

  it('says what a phone can do and lists everything it never can', async () => {
    fakeRemote()
    render(<DevicesSettings />)
    const can = await screen.findByTestId('devices-scope-can')
    expect(can).toHaveTextContent('Watch terminal output (read only)')
    expect(can).toHaveTextContent('Type in a terminal you allowed here')
    const cannot = screen.getByTestId('devices-scope-cannot')
    expect(within(cannot).getAllByRole('listitem')).toHaveLength(REMOTE_FORBIDDEN.length)
    expect(cannot).toHaveTextContent('Approve OxeQuery changes')
    expect(cannot).toHaveTextContent('Read secrets')
    expect(cannot).toHaveTextContent('Change policy')
  })

  it('counts the terminals a phone may type in and stops them all', async () => {
    const { api } = fakeRemote({ status: { phoneWritePanes: ['pane-a', 'pane-b'] } })
    render(<DevicesSettings />)
    expect(await screen.findByTestId('devices-typing')).toHaveTextContent('Terminals a phone can type in: 2')
    await userEvent.click(screen.getByRole('button', { name: 'Stop typing from the phone everywhere' }))
    expect(api.setPhoneWrite).toHaveBeenCalledWith({ paneId: 'pane-a', allowed: false })
    expect(api.setPhoneWrite).toHaveBeenCalledWith({ paneId: 'pane-b', allowed: false })
    await waitFor(() => expect(screen.getByTestId('devices-typing')).toHaveTextContent('Phones cannot type in any terminal'))
  })
})

describe('formatMainMessage', () => {
  it('words a main-process message in the interface language', async () => {
    expect(formatMainMessage({ code: 'remote.port.privileged', params: { port: 80 } })).toBe('Pick a port of 1024 or above; port 80 is reserved by the system.')
    await changeLanguage('pt-BR')
    expect(formatMainMessage({ code: 'remote.network.noPrivateInterface', params: {} })).toMatch(/^Nenhuma rede privada encontrada/)
  })
})

function PaneHarness({ paneId }: { paneId: string }): ReactElement {
  const phoneWrite = usePhoneWrite(paneId)
  return <div>
    {phoneWrite.allowed && <PhoneWriteBadge />}
    <div role="menu">{phoneWrite.offered && <PhoneWriteMenuItem paneId={paneId} allowed={phoneWrite.allowed} onDone={action => action()} />}</div>
  </div>
}

describe('Allow typing from the phone (pane)', () => {
  it('is not offered while the phone connection is off', async () => {
    const { api } = fakeRemote()
    render(<PaneHarness paneId="pane-a" />)
    await waitFor(() => expect(api.status).toHaveBeenCalled())
    expect(screen.queryByRole('menuitemcheckbox')).toBeNull()
    expect(screen.queryByTestId('pane-phone-write')).toBeNull()
  })

  it('is off by default, and shows a sign on the pane while on', async () => {
    const { api } = fakeRemote({ status: { enabled: true, listening: { addresses: ['192.168.0.10'], port: 47321 } } })
    render(<PaneHarness paneId="pane-a" />)
    const item = await screen.findByRole('menuitemcheckbox', { name: 'Allow typing from the phone' })
    expect(item).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByTestId('pane-phone-write')).toBeNull()
    await userEvent.click(item)
    expect(api.setPhoneWrite).toHaveBeenCalledWith({ paneId: 'pane-a', allowed: true })
    expect(await screen.findByTestId('pane-phone-write')).toHaveTextContent('Phone can type')
    expect(screen.getByRole('menuitemcheckbox')).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('menuitemcheckbox'))
    expect(api.setPhoneWrite).toHaveBeenLastCalledWith({ paneId: 'pane-a', allowed: false })
    await waitFor(() => expect(screen.queryByTestId('pane-phone-write')).toBeNull())
  })
})
