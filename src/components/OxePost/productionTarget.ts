import { findVariables, interpolate } from '../../../shared/oxepost/variables'
import type { PostEnvironmentView } from '../../../shared/oxepost/types'

/** What the window shows in place of a secret's value; the value itself never reaches the page. */
export const SECRET_MASK = '••••'

export type ProductionTarget =
  /** Every variable has a value: the address the request goes to, secrets masked. */
  | { kind: 'resolved'; url: string; origin?: string; rest?: string; maskedSecrets: string[] }
  /** Some variables have no value in this environment: the address is not known, and main refuses the send. */
  | { kind: 'missing'; missing: string[] }

/**
 * The address a production send goes to, resolved the way main does when it sends (shared/oxepost/variables.ts):
 * the environment's variables, then its secrets. Secrets are masked here, since the page only knows whether each is
 * set (P1-10). A secret that is not set counts as missing, as it does in main.
 */
export function productionTarget(url: string, environment: Pick<PostEnvironmentView, 'variables' | 'secrets' | 'secretState'> | undefined): ProductionTarget {
  const values: Record<string, string> = { ...(environment?.variables ?? {}) }
  const used = new Set(findVariables(url))
  const maskedSecrets: string[] = []
  for (const name of environment?.secrets ?? []) {
    if (environment?.secretState[name] !== 'set') continue
    values[name] = SECRET_MASK
    if (used.has(name)) maskedSecrets.push(name)
  }
  const { text, missing } = interpolate(url, values)
  if (missing.length) return { kind: 'missing', missing }
  try {
    const parsed = new URL(text)
    const origin = `${parsed.protocol}//${parsed.host}`
    // The host is shown apart only when the text starts with it as written (URL may normalise case or ports).
    if (!text.startsWith(origin)) return { kind: 'resolved', url: text, maskedSecrets }
    return { kind: 'resolved', url: text, origin, rest: text.slice(origin.length), maskedSecrets }
  } catch {
    return { kind: 'resolved', url: text, maskedSecrets }
  }
}
