/** C3 message codes of the app domain (`app.*`, `oxe.*`, `memory.*`); merged into `MessageParams` and `MESSAGE_CODES` by shared/messages.ts. */

export interface AppMessageParams {
  /** The system reports no network interface with a route. */
  'app.connectivity.offline': Record<string, never>
  'oxe.status.unreadable': Record<string, never>
  'oxe.dashboard.timeout': Record<string, never>
  'memory.disabled': Record<string, never>
  'memory.unavailable': Record<string, never>
  'memory.runtimeUnavailable': Record<string, never>
}

export const APP_MESSAGE_CODES = [
  'app.connectivity.offline',
  'oxe.status.unreadable',
  'oxe.dashboard.timeout',
  'memory.disabled',
  'memory.unavailable',
  'memory.runtimeUnavailable'
] as const satisfies readonly (keyof AppMessageParams)[]
