/** C3 message codes of the oxepod domain (`oxepod.*`); merged into `MessageParams` and `MESSAGE_CODES` by shared/messages.ts. */

export interface OxepodMessageParams {
  'oxepod.startFailed': { reason: string }
}

export const OXEPOD_MESSAGE_CODES = [
  'oxepod.startFailed'
] as const satisfies readonly (keyof OxepodMessageParams)[]
