import type { OxeQueryErrorInfo, OxeQueryOp, OxeQueryOps } from '../../../shared/types/oxequery'

export class OxeQueryClientError extends Error {
  readonly code: OxeQueryErrorInfo['code']
  readonly reasons: string[]
  constructor(info: OxeQueryErrorInfo) {
    super(info.message)
    this.name = 'OxeQueryClientError'
    this.code = info.code
    this.reasons = info.reasons ?? []
  }
}

/** One call to the main process; failures come back as a typed error instead of a rejected IPC. */
export async function oq<K extends OxeQueryOp>(op: K, input: OxeQueryOps[K]['input']): Promise<OxeQueryOps[K]['output']> {
  const api = window.oxe?.oxeQuery
  if (!api) throw new OxeQueryClientError({ code: 'failed', message: 'OxeQuery is unavailable. Restart the updated application.' })
  const response = await api.call(op, input)
  if (!response.ok) throw new OxeQueryClientError(response.error)
  return response.value
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}
