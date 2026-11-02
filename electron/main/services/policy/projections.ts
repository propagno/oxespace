import { parsePolicy, type PolicyLayer } from '../../../../shared/policy'
import type { PolicyProjection } from './accepted-config'

/** The largest policy file read; a larger one is `invalid` (it is a change like any other, B7.4). */
export const MAX_POLICY_BYTES = 256 * 1024

/**
 * B7.4 · A policy file's text as its security projection: `absent` (no file), `invalid` (not a valid policy, or too
 * large; `problem` says why, with the path) or its rules in order. A file that is not valid is refused whole, never
 * applied in part. The projection keeps the reason without the path, for the request's note.
 */
export function parsePolicyProjection(text: string | null, layer: PolicyLayer, path: string): { projection: PolicyProjection; problem?: string } {
  if (text === null) return { projection: { state: 'absent' } }
  if (Buffer.byteLength(text, 'utf8') > MAX_POLICY_BYTES) return tooLarge(path)
  const parsed = parsePolicy(text, layer, path)
  if ('problem' in parsed) return { projection: { state: 'invalid', problem: parsed.problem.startsWith(`${path}: `) ? parsed.problem.slice(path.length + 2) : parsed.problem }, problem: parsed.problem }
  const { rules, organization } = parsed.source
  return { projection: { state: 'value', value: { rules, ...(organization ? { organization } : {}) } } }
}

export function tooLarge(path: string): { projection: PolicyProjection; problem: string } {
  return { projection: { state: 'invalid', tooLarge: true }, problem: `${path}: larger than ${MAX_POLICY_BYTES / 1024} KB` }
}
