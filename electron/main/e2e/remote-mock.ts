/**
 * A pretend remote gateway for the E2E runs of Settings › Devices: no socket, no certificate. One phone is paired
 * unless `OXESPACE_E2E_REMOTE_DEVICES=0`; with `OXESPACE_E2E_REMOTE_PAIR_PROMPT=1`, a phone asks to pair shortly after a
 * pairing code is shown, so a spec can answer it. With `OXESPACE_E2E_REMOTE_PAIR_FAIL=<reason>` (invalid, expired,
 * refused, limit, peer-closed), a pairing attempt fails that way shortly after a code is shown. `OXESPACE_E2E_REMOTE_LISTENED=1`
 * starts as if the gateway had listened before on this profile.
 *
 * Rejections carry the same C3 codes as the real gateway; malformed input stays a plain Error.
 */
import { BrowserWindow, ipcMain } from 'electron'
import { mainMessage } from '../../../shared/messages'
import { MainMessageError } from '../ipc/main-message-error'
import { pairingUri, REMOTE_LIMITS, REMOTE_PROTOCOL_VERSION } from '../../../shared/remote/protocol'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import {
  REMOTE_DEFAULT_DESKTOP_NAME, REMOTE_MAX_DESKTOP_NAME_LENGTH, REMOTE_MIN_PORT, REMOTE_PAIRING_FAILURE_REASONS, type RemoteChange, type RemoteDevice,
  type RemoteGatewayStatus, type RemotePairingFailureReason, type RemotePairingPrompt
} from '../../../shared/types/remote'

const CONTROL = /[\u0000-\u001f\u007f]/
const PANE_ID = /^[A-Za-z0-9._:-]{1,200}$/
const goodName = (name: string, max: number) => !!name.trim() && name.trim().length <= max && !CONTROL.test(name)

export function registerRemoteMock(): void {
  const fingerprint = 'ab'.repeat(32)
  let enabled = false, port = 47_321, error: RemoteGatewayStatus['error'], desktopName = REMOTE_DEFAULT_DESKTOP_NAME
  let listenedBefore = process.env.OXESPACE_E2E_REMOTE_LISTENED === '1'
  let prompt: RemotePairingPrompt | null = null, offerExpiresAt = 0
  const failWith = REMOTE_PAIRING_FAILURE_REASONS.find(reason => reason === process.env.OXESPACE_E2E_REMOTE_PAIR_FAIL) as RemotePairingFailureReason | undefined
  const phoneWritePanes = new Set<string>()
  const devices: RemoteDevice[] = process.env.OXESPACE_E2E_REMOTE_DEVICES === '0' ? [] : [{ deviceId: 'device-1', name: 'Pixel 8', pairedAt: 1, lastSeenAt: 2, connected: true }]
  const status = (): RemoteGatewayStatus => ({
    enabled, desktopName, phoneWritePanes: [...phoneWritePanes], listening: enabled ? { addresses: ['192.168.0.10'], port } : null, fingerprint, devices: devices.length,
    maxDevices: REMOTE_LIMITS.maxDevices, listenedBefore, ...(error ? { error } : {})
  })
  const send = (channel: string, payload: unknown) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload) }
  const changed = (change: RemoteChange) => send(IPC_CHANNELS.remote.changed, change)
  const find = (deviceId: unknown) => {
    if (typeof deviceId !== 'string') throw new Error('deviceId must be a string')
    const device = devices.find(value => value.deviceId === deviceId)
    if (!device) throw new MainMessageError(mainMessage('remote.device.notFound', {}), 'Unknown device')
    return device
  }

  ipcMain.handle(IPC_CHANNELS.remote.status, () => status())
  ipcMain.handle(IPC_CHANNELS.remote.devices, () => devices)
  ipcMain.handle(IPC_CHANNELS.remote.setEnabled, (_event, input: { enabled?: unknown; port?: unknown }) => {
    if (typeof input?.enabled !== 'boolean') throw new Error('Invalid gateway input')
    if (input.port !== undefined && (!Number.isInteger(input.port) || Number(input.port) > 65_535)) throw new Error('Invalid gateway port')
    if (input.port !== undefined && Number(input.port) < REMOTE_MIN_PORT) {
      enabled = false; error = mainMessage('remote.port.privileged', { port: Number(input.port) })
    } else {
      enabled = input.enabled; error = undefined; if (input.port !== undefined) port = Number(input.port)
    }
    if (enabled) listenedBefore = true
    if (!enabled) { prompt = null; offerExpiresAt = 0 }
    changed({ status: status() })
    return status()
  })
  ipcMain.handle(IPC_CHANNELS.remote.startPairing, () => {
    if (!enabled) throw new MainMessageError(mainMessage('remote.gateway.offline', {}), 'Turn the gateway on first')
    if (devices.length >= REMOTE_LIMITS.maxDevices) throw new MainMessageError(mainMessage('remote.pairing.limit', { max: REMOTE_LIMITS.maxDevices }), 'Too many devices')
    offerExpiresAt = Date.now() + REMOTE_LIMITS.pairingCodeTtlMs
    if (failWith) setTimeout(() => { if (offerExpiresAt) send(IPC_CHANNELS.remote.pairingFailed, mainMessage('remote.pairing.failed', { reason: failWith })) }, 300)
    else if (process.env.OXESPACE_E2E_REMOTE_PAIR_PROMPT === '1') setTimeout(() => {
      if (!offerExpiresAt) return
      prompt = { promptId: 'prompt-1', deviceName: 'Pixel 8 Pro', verification: '28T5CY', expiresAt: Date.now() + 60_000 }
      changed({ pairing: prompt })
    }, 300)
    return { uri: pairingUri({ v: REMOTE_PROTOCOL_VERSION, host: '192.168.0.10', port, fp: fingerprint, code: 'e2e-pairing-code-00000', name: desktopName }), expiresAt: offerExpiresAt }
  })
  ipcMain.handle(IPC_CHANNELS.remote.cancelPairing, () => {
    offerExpiresAt = 0
    if (prompt) { prompt = null; changed({ pairing: null }); send(IPC_CHANNELS.remote.pairingFailed, mainMessage('remote.pairing.failed', { reason: 'refused' })) }
  })
  ipcMain.handle(IPC_CHANNELS.remote.answerPairing, (_event, input: { promptId?: unknown; accept?: unknown }) => {
    if (!prompt || input?.promptId !== prompt.promptId || typeof input.accept !== 'boolean') throw new Error('No such pairing request')
    if (input.accept) devices.push({ deviceId: `device-${devices.length + 1}`, name: prompt.deviceName, pairedAt: Date.now(), lastSeenAt: Date.now(), connected: true })
    prompt = null; offerExpiresAt = 0
    changed({ pairing: null, devices: [...devices], status: status() })
    if (!input.accept) send(IPC_CHANNELS.remote.pairingFailed, mainMessage('remote.pairing.failed', { reason: 'refused' }))
  })
  ipcMain.handle(IPC_CHANNELS.remote.revoke, (_event, input: { deviceId?: unknown }) => {
    devices.splice(devices.indexOf(find(input?.deviceId)), 1)
    changed({ devices: [...devices], status: status() })
  })
  ipcMain.handle(IPC_CHANNELS.remote.setDesktopName, (_event, input: { name?: unknown }) => {
    if (input?.name !== null && typeof input?.name !== 'string') throw new Error('Invalid desktop name input')
    if (typeof input.name === 'string' && !goodName(input.name, REMOTE_MAX_DESKTOP_NAME_LENGTH)) {
      throw new MainMessageError(mainMessage('remote.desktop.invalidName', { max: REMOTE_MAX_DESKTOP_NAME_LENGTH }), 'Invalid desktop name')
    }
    desktopName = input.name === null ? REMOTE_DEFAULT_DESKTOP_NAME : input.name.trim()
    changed({ status: status() })
    return status()
  })
  ipcMain.handle(IPC_CHANNELS.remote.setPhoneWrite, (_event, input: { paneId?: unknown; allowed?: unknown }) => {
    if (typeof input?.paneId !== 'string' || typeof input.allowed !== 'boolean') throw new Error('Invalid pane input')
    if (!PANE_ID.test(input.paneId)) throw new MainMessageError(mainMessage('remote.pane.invalid', {}), 'Invalid pane')
    if (input.allowed) phoneWritePanes.add(input.paneId); else phoneWritePanes.delete(input.paneId)
    changed({ status: status() })
    return status()
  })
  ipcMain.handle(IPC_CHANNELS.remote.rename, (_event, input: { deviceId?: unknown; name?: unknown }) => {
    const device = find(input?.deviceId)
    if (typeof input.name !== 'string') throw new Error('Invalid device name input')
    if (!goodName(input.name, REMOTE_LIMITS.maxDeviceNameLength)) {
      throw new MainMessageError(mainMessage('remote.device.invalidName', { max: REMOTE_LIMITS.maxDeviceNameLength }), 'Invalid device name')
    }
    device.name = input.name.trim()
    changed({ devices: [...devices] })
    return device
  })
}
