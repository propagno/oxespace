import type { OxePodErrorInfo, OxePodOp, OxePodOps } from '../../../shared/types/oxepod'
import { tp } from './catalog'

export class OxePodClientError extends Error {
  readonly code: OxePodErrorInfo['code']
  readonly reasons: string[]
  constructor(info: OxePodErrorInfo) {
    super(info.message)
    this.name = 'OxePodClientError'
    this.code = info.code
    this.reasons = info.reasons ?? []
  }
}

/** One call to OxePod in the main process; failures come back as a typed error instead of a rejected IPC. */
export async function pod<K extends OxePodOp>(op: K, input: OxePodOps[K]['input']): Promise<OxePodOps[K]['output']> {
  const api = window.oxe?.oxePod
  if (!api) throw new OxePodClientError({ code: 'failed', message: tp('client.unavailable') })
  const response = await api.call(op, input)
  if (!response.ok) throw new OxePodClientError(response.error)
  return response.value
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : tp('client.unknown')
}
