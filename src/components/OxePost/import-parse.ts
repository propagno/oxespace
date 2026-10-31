import { parseCurl } from '../../../shared/oxepost/curl'
import { parseOpenApi } from '../../../shared/oxepost/openapi'
import type { PostRequest } from '../../../shared/oxepost/types'

export type ImportKind = 'curl' | 'openapi'
export interface ParsedImport { requests: Array<{ folder: string; request: PostRequest }>; warnings: string[]; baseUrl: string; title: string }

/** Turns a pasted cURL command or an OpenAPI 3 document (JSON or YAML) into requests; throws a message the person can act on. */
export function parseImport(kind: ImportKind, text: string): ParsedImport {
  if (kind === 'curl') {
    const { request, warnings } = parseCurl(text)
    return { requests: [{ folder: '', request }], warnings, baseUrl: '', title: '' }
  }
  const result = parseOpenApi(text)
  return { requests: result.requests, warnings: result.warnings, baseUrl: result.baseUrl, title: result.title }
}
