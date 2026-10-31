/** C3 message codes of the activity domain (`activity.*`); merged into `MessageParams` and `MESSAGE_CODES` by shared/messages.ts. */

export interface ActivityMessageParams {
  /** F30 · Refusals of the activity center's calls (ACTIVITY_REFUSALS); a refused call stores nothing. */
  'activity.invalid': Record<string, never>
  'activity.tooMany': { max: number }
  'activity.titleTooLong': { max: number }
  'activity.detailTooLong': { max: number }
  'activity.hiddenCharacters': Record<string, never>
  /** A time more than a minute ahead of the computer's clock. */
  'activity.future': Record<string, never>
  /** An entry's text looks like a password, token or key; the whole call is refused, nothing is stored. */
  'activity.secret': Record<string, never>
}

export const ACTIVITY_MESSAGE_CODES = [
  'activity.invalid',
  'activity.tooMany',
  'activity.titleTooLong',
  'activity.detailTooLong',
  'activity.hiddenCharacters',
  'activity.future',
  'activity.secret'
] as const satisfies readonly (keyof ActivityMessageParams)[]
