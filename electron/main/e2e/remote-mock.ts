/**
 * A pretend remote gateway for the E2E runs of Settings › Devices: no socket, no certificate. One phone is paired
 * unless `OXESPACE_E2E_REMOTE_DEVICES=0`; with `OXESPACE_E2E_REMOTE_PAIR_PROMPT=1`, a phone asks to pair shortly after a
 * pairing code is shown, so a spec can answer it.
 */
import { BrowserWindow, ipcMain } from 'electron'
import { mainMessage } from '../../../shared/messages'
import { pairingUri, REMOTE_LIMITS, REMOTE_PROTOCOL_VERSION } from '../../../shared/remote/protocol'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { REMOTE_DEFAULT_DESKTOP_NAME, REMOTE_MAX_DESKTOP_NAME_LENGTH, REMOTE_MIN_PORT, type RemoteChange, type RemoteDevice, type RemoteGatewayStatus, type RemotePairingPrompt } from '../../../shared/types/remote'

export function registerRemoteMock(): void {
  const fingerprint = 'ab'.repeat(32)
  let enabled = false, port = 47_321, error: RemoteGatewayStatus['error'], desktopName = REMOTE_DEFAULT_DESKTOP_NAME
  let prompt: RemotePairingPrompt | null = null, offerExpiresAt = 0
  const devices: RemoteDevice[] = process.env.OXESPACE_E2E_REMOTE_DEVICES === '0' ? [] : [{ deviceId: 'device-1', name: 'Pixel 8', pairedAt: 1, lastSeenAt: 2, connected: true }]
  const status = (): RemoteGatewayStatus => ({
    enabled, desktopName, listening: enabled ? { addresses: ['192.168.0.10'], port } : null, fingerprint, devices: devices.length, maxDevices: REMOTE_LIMITS.maxDevices, ...(error ? { error } : {})
  })
  const changed = (change: RemoteChange) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send(IPC_CHANNELS.remote.changed, change) }
  const find = (deviceId: unknown) => {
    const device = devices.find(value => value.deviceId === deviceId)
    if (!device) throw new Error('Unknown device')
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
    if (!enabled) { prompt = null; offerExpiresAt = 0 }
    changed({ status: status() })
    return status()
  })
  ipcMain.handle(IPC_CHANNELS.remote.startPairing, () => {
    if (!enabled) throw new Error('Turn the gateway on first')
    if (devices.length >= REMOTE_LIMITS.maxDevices) throw new Error('Too many devices')
    offerExpiresAt = Date.now() + REMOTE_LIMITS.pairingCodeTtlMs
    if (process.env.OXESPACE_E2E_REMOTE_PAIR_PROMPT === '1') setTimeout(() => {
      if (!offerExpiresAt) return
      prompt = { promptId: 'prompt-1', deviceName: 'Pixel 8 Pro', verification: '28T5CY', expiresAt: Date.now() + 60_000 }
      changed({ pairing: prompt })
    }, 300)
    return { uri: pairingUri({ v: REMOTE_PROTOCOL_VERSION, host: '192.168.0.10', port, fp: fingerprint, code: 'e2e-pairing-code-00000', name: desktopName }), expiresAt: offerExpiresAt }
  })
  ipcMain.handle(IPC_CHANNELS.remote.cancelPairing, () => {
    offerExpiresAt = 0
    if (prompt) { prompt = null; changed({ pairing: null }) }
  })
  ipcMain.handle(IPC_CHANNELS.remote.answerPairing, (_event, input: { promptId?: unknown; accept?: unknown }) => {
    if (!prompt || input?.promptId !== prompt.promptId || typeof input.accept !== 'boolean') throw new Error('No such pairing request')
    if (input.accept) devices.push({ deviceId: `device-${devices.length + 1}`, name: prompt.deviceName, pairedAt: Date.now(), lastSeenAt: Date.now(), connected: true })
    prompt = null; offerExpiresAt = 0
    changed({ pairing: null, devices: [...devices], status: status() })
  })
  ipcMain.handle(IPC_CHANNELS.remote.revoke, (_event, input: { deviceId?: unknown }) => {
    devices.splice(devices.indexOf(find(input?.deviceId)), 1)
    changed({ devices: [...devices], status: status() })
  })
  ipcMain.handle(IPC_CHANNELS.remote.setDesktopName, (_event, input: { name?: unknown }) => {
    if (input?.name !== null && (typeof input?.name !== 'string' || !input.name.trim() || input.name.length > REMOTE_MAX_DESKTOP_NAME_LENGTH)) throw new Error('Invalid desktop name')
    desktopName = input.name === null ? REMOTE_DEFAULT_DESKTOP_NAME : input.name.trim()
    changed({ status: status() })
    return status()
  })
  ipcMain.handle(IPC_CHANNELS.remote.rename, (_event, input: { deviceId?: unknown; name?: unknown }) => {
    const device = find(input?.deviceId)
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > REMOTE_LIMITS.maxDeviceNameLength) throw new Error('Invalid device name')
    device.name = input.name.trim()
    changed({ devices: [...devices] })
    return device
  })
}
