import { REMOTE_LIMITS } from '../../../../shared/remote/protocol'
import { REMOTE_MAX_DESKTOP_NAME_LENGTH } from '../../../../shared/types/remote'

/**
 * Strict readers for what the window sends on the `remote.*` channels. Unknown fields, wrong types and out-of-range
 * values reject, so nothing unexpected ever reaches the gateway.
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

export function parseDeviceId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('Unknown device')
  return value
}

/** A display name: trimmed, 1–64 characters, no control characters. */
export function parseDeviceName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid device name')
  const name = value.trim()
  if (!name || name.length > REMOTE_LIMITS.maxDeviceNameLength || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Invalid device name')
  return name
}

const PANE_ID = /^[A-Za-z0-9._:-]{1,200}$/

/** `{ paneId, allowed }`: whether a phone may type into that pane. */
export function parsePhoneWriteInput(value: unknown): { paneId: string; allowed: boolean } {
  const input = record(value, 'Pane input', ['paneId', 'allowed'])
  if (typeof input.paneId !== 'string' || !PANE_ID.test(input.paneId)) throw new Error('Invalid pane')
  if (typeof input.allowed !== 'boolean') throw new Error('allowed must be a boolean')
  return { paneId: input.paneId, allowed: input.allowed }
}

/** `{ name }`: the name phones see, trimmed, 1–32 characters without control characters; `null` goes back to the default. */
export function parseDesktopNameInput(value: unknown): { name: string | null } {
  const input = record(value, 'Desktop name input', ['name'])
  if (input.name === null) return { name: null }
  if (typeof input.name !== 'string') throw new Error('Invalid desktop name')
  const name = input.name.trim()
  if (!name || name.length > REMOTE_MAX_DESKTOP_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Invalid desktop name')
  return { name }
}
