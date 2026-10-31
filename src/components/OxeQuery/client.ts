import type { OxeQueryErrorInfo, OxeQueryOp, OxeQueryOps } from '../../../shared/types/oxequery'
import { tq } from './catalog'

export class OxeQueryClientError extends Error {
  readonly code: OxeQueryErrorInfo['code']
  readonly reasons: string[]
  readonly position?: number
  readonly sqlState?: string
  readonly hint?: string
  constructor(info: OxeQueryErrorInfo) {
    super(info.message)
    this.name = 'OxeQueryClientError'
    this.code = info.code
    this.reasons = info.reasons ?? []
    if (info.position !== undefined) this.position = info.position
    if (info.sqlState) this.sqlState = info.sqlState
    if (info.hint) this.hint = info.hint
  }
}

/** One call to the main process; failures come back as a typed error instead of a rejected IPC. */
export async function oq<K extends OxeQueryOp>(op: K, input: OxeQueryOps[K]['input']): Promise<OxeQueryOps[K]['output']> {
  const api = window.oxe?.oxeQuery
  if (!api) throw new OxeQueryClientError({ code: 'failed', message: tq('client.unavailable') })
  const response = await api.call(op, input)
  if (!response.ok) throw new OxeQueryClientError(response.error)
  return response.value
}

export function errorMessage(error: unknown): string {
  if (error instanceof OxeQueryClientError && error.hint) return `${error.message}\n${tq('client.hint', { hint: error.hint })}`
  return error instanceof Error ? error.message : tq('client.unknown')
}
