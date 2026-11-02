import { reservedNameIn } from '../../../../shared/approval-rules'
import { hasHiddenCharacters } from '../../../../shared/hidden-characters'
import { mainMessage } from '../../../../shared/messages'
import { MainMessageError } from '../../ipc/main-message-error'
import { REMOTE_LIMITS } from '../../../../shared/remote/protocol'
import { REMOTE_MAX_DESKTOP_NAME_LENGTH } from '../../../../shared/types/remote'

/**
 * Strict readers for what the window sends on the `remote.*` channels. Unknown fields, wrong types and out-of-range
 * values reject, so nothing unexpected ever reaches the gateway. A value of the right type the person can fix (a name
 * too long, an id that is no device) rejects with a C3 code (`MainMessageError`); malformed input is a plain Error.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function record(value: unknown, label: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`${label} must be an object`)
  const input = value as Record<string, unknown>
  const unknown = Object.keys(input).filter(key => !required.includes(key) && !optional.includes(key))
  if (unknown.length) throw new Error(`${label} has unknown fields`)
  for (const key of required) if (!(key in input)) throw new Error(`${label} is missing ${key}`)
  return input
}

export function parseNoInput(value: unknown): void {
  if (value !== undefined) throw new Error('This request takes no input')
}

/** `port` may be any integer 0–65535; one below 1024 is refused by the gateway with a message, not here. */
export function parseSetEnabledInput(value: unknown): { enabled: boolean; port?: number } {
  const input = record(value, 'Gateway input', ['enabled'], ['port'])
  if (typeof input.enabled !== 'boolean') throw new Error('enabled must be a boolean')
  if (input.port === undefined) return { enabled: input.enabled }
  if (typeof input.port !== 'number' || !Number.isInteger(input.port) || input.port < 0 || input.port > 65_535) throw new Error('port must be an integer from 0 to 65535')
  return { enabled: input.enabled, port: input.port }
}

export function parseAnswerPairingInput(value: unknown): { promptId: string; accept: boolean } {
  const input = record(value, 'Pairing answer', ['promptId', 'accept'])
  if (typeof input.promptId !== 'string' || !UUID.test(input.promptId)) throw new Error('No such pairing request')
  if (typeof input.accept !== 'boolean') throw new Error('accept must be a boolean')
  return { promptId: input.promptId, accept: input.accept }
}

export function parseDeviceInput(value: unknown): { deviceId: string } {
  const input = record(value, 'Device input', ['deviceId'])
  return { deviceId: parseDeviceId(input.deviceId) }
}

export function parseRenameInput(value: unknown): { deviceId: string; name: string } {
  const input = record(value, 'Rename input', ['deviceId', 'name'])
  return { deviceId: parseDeviceId(input.deviceId), name: parseDeviceName(input.name) }
}

export const deviceNotFound = (): MainMessageError => new MainMessageError(mainMessage('remote.device.notFound', {}), 'Unknown device')

/** A string that is not a device id is no device: `remote.device.notFound`. Anything but a string is malformed. */
export function parseDeviceId(value: unknown): string {
  if (typeof value !== 'string') throw new Error('deviceId must be a string')
  if (!UUID.test(value)) throw deviceNotFound()
  return value
}

/** A device name without its invisible format characters (zero-width spaces, joiners, direction marks), trimmed. */
export const cleanDeviceName = (value: string): string => value.replace(/\p{Cf}/gu, '').trim()

/**
 * Why a cleaned device name is refused: nothing left, too long or control characters (`invalid`), or a name only
 * the app may speak as, "OXESpace" or "System" and their look-alikes (`reserved`). The phone's own choice at pairing
 * and the person's at rename go through the same check.
 */
export function deviceNameProblem(name: string): 'invalid' | 'reserved' | null {
  if (!name || name.length > REMOTE_LIMITS.maxDeviceNameLength || /[\u0000-\u001f\u007f-\u009f]/.test(name)) return 'invalid'
  return reservedNameIn(name) ? 'reserved' : null
}

/** A display name: cleaned, 1–64 characters, no control characters, not reserved. */
export function parseDeviceName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('name must be a string')
  const name = cleanDeviceName(value)
  const problem = deviceNameProblem(name)
  if (problem === 'invalid') throw new MainMessageError(mainMessage('remote.device.invalidName', { max: REMOTE_LIMITS.maxDeviceNameLength }), 'Invalid device name')
  if (problem === 'reserved') throw new MainMessageError(mainMessage('remote.device.reservedName', {}), 'Reserved device name')
  return name
}

/**
 * `{ name }`: the name phones see, trimmed, 1–32 characters without control or hidden characters (bidi, zero-width:
 * the phone would show something else than what was typed), and not a name only the app or the system speaks as
 * ("Windows Security", "OXESpace Admin"). `null` goes back to the default.
 */
export function parseDesktopNameInput(value: unknown): { name: string | null } {
  const input = record(value, 'Desktop name input', ['name'])
  if (input.name === null) return { name: null }
  if (typeof input.name !== 'string') throw new Error('name must be a string or null')
  const name = input.name.trim()
  if (!name || name.length > REMOTE_MAX_DESKTOP_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(name) || hasHiddenCharacters(name)) {
    throw new MainMessageError(mainMessage('remote.desktop.invalidName', { max: REMOTE_MAX_DESKTOP_NAME_LENGTH }), 'Invalid desktop name')
  }
  if (reservedNameIn(name)) throw new MainMessageError(mainMessage('remote.desktop.reservedName', {}), 'Reserved desktop name')
  return { name }
}

const PANE_ID = /^[A-Za-z0-9._:-]{1,200}$/

/** `{ paneId, allowed }`: one pane the phone may type into, or not. */
export function parseSetPhoneWriteInput(value: unknown): { paneId: string; allowed: boolean } {
  const input = record(value, 'Phone write input', ['paneId', 'allowed'])
  if (typeof input.paneId !== 'string') throw new Error('paneId must be a string')
  if (!PANE_ID.test(input.paneId)) throw new MainMessageError(mainMessage('remote.pane.invalid', {}), 'Invalid pane')
  if (typeof input.allowed !== 'boolean') throw new Error('allowed must be a boolean')
  return { paneId: input.paneId, allowed: input.allowed }
}
