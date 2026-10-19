import { humanizeError } from '../../utils/humanizeError'

/** A readable message for an error from a Thread action (see humanizeError). */
export function threadError(error: unknown): string {
  return humanizeError(error, 'Could not complete the action.')
}
