import { LIMITS, type PostRequest, type PostResponse } from '../../../../shared/oxepost/types'

export class SendError extends Error {
  constructor(readonly code: 'invalid' | 'timeout' | 'network' | 'tls', message: string) { super(message); this.name = 'SendError' }
}

const TLS_CODES = new Set(['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_NOT_YET_VALID', 'CERT_UNTRUSTED'])
const NETWORK_TEXT: Record<string, string> = {
  ENOTFOUND: 'The host name was not found. Check the URL and the connection.',
  ECONNREFUSED: 'The connection was refused: nothing is listening at that address and port.',
  ECONNRESET: 'The server closed the connection before answering.',
  ETIMEDOUT: 'The connection timed out.', EAI_AGAIN: 'The host name could not be looked up right now.', EHOSTUNREACH: 'The host cannot be reached.', ENETUNREACH: 'The network cannot be reached.'
}
const TEXTUAL = /^(text\/|application\/(json|xml|javascript|x-javascript|x-www-form-urlencoded|graphql|yaml|x-yaml|ld\+json|problem\+json|x-ndjson)|image\/svg)|[+/](json|xml|yaml)\b/i

export interface SendOptions { timeoutMs?: number; maxBody?: number; fetchImpl?: typeof fetch; userAgent?: string }

/** Performs one request from the main process. TLS is verified (Node's defaults, no override), redirects are followed, the body shown is capped. */
export async function sendRequest(request: PostRequest, options: SendOptions = {}): Promise<PostResponse> {
  const timeoutMs = Math.min(LIMITS.maxTimeoutMs, Math.max(1000, options.timeoutMs ?? LIMITS.defaultTimeoutMs))
  const cap = options.maxBody ?? LIMITS.responseBodyBytes
  let url: URL
  try { url = new URL(request.url.trim()) } catch { throw new SendError('invalid', 'The URL is not valid. It needs a scheme, such as https://example.com/path') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SendError('invalid', 'Only http and https URLs can be sent')
  if (request.body !== '' && (request.method === 'GET' || request.method === 'HEAD')) throw new SendError('invalid', `${request.method} cannot carry a body. Change the method or clear the body`)
  if (Buffer.byteLength(request.body) > LIMITS.requestBodyBytes) throw new SendError('invalid', 'The body is larger than 5 MB')

  const headers = new Headers()
  for (const header of request.headers) {
    if (!header.enabled || !header.name.trim()) continue
    try { headers.append(header.name.trim(), header.value) } catch { throw new SendError('invalid', `"${header.name}" is not a valid header`) }
  }
  const auth = request.auth
  if (auth.type === 'bearer' && auth.token) headers.set('Authorization', `Bearer ${auth.token}`)
  else if (auth.type === 'basic') headers.set('Authorization', `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`)
  else if (auth.type === 'apikey' && auth.name) { if (auth.in === 'header') headers.set(auth.name, auth.value); else url.searchParams.set(auth.name, auth.value) }
  if (!headers.has('user-agent')) headers.set('User-Agent', options.userAgent ?? 'OXESpace-OxePost')
  if (request.body !== '' && !headers.has('content-type') && /^\s*[[{]/.test(request.body)) headers.set('Content-Type', 'application/json')

  const started = performance.now()
  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(url, { method: request.method, headers, body: request.body === '' ? undefined : request.body, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    throw describeFailure(error, timeoutMs)
  }

  let kept: Buffer[] = [], keptBytes = 0, size = 0, truncated = false
  try {
    const reader = response.body?.getReader()
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (keptBytes < cap) { const piece = Buffer.from(value.subarray(0, cap - keptBytes)); kept.push(piece); keptBytes += piece.byteLength }
        if (size > cap) truncated = true
        // Past 64 MB there is nothing more to learn: stop downloading and say so.
        if (size > 64 * 1024 * 1024) { await reader.cancel(); break }
      }
    }
  } catch (error) {
    throw describeFailure(error, timeoutMs)
  }
  const ms = Math.round(performance.now() - started)
  const bytes = Buffer.concat(kept)
  kept = []
  const contentType = response.headers.get('content-type') ?? ''
  const binary = contentType ? !TEXTUAL.test(contentType) && bytes.includes(0) : bytes.subarray(0, 4096).includes(0)
  const list: Array<{ name: string; value: string }> = []
  response.headers.forEach((value, name) => { if (name !== 'set-cookie') list.push({ name, value }) })
  for (const cookie of response.headers.getSetCookie?.() ?? []) list.push({ name: 'set-cookie', value: cookie })
  return {
    status: response.status, statusText: response.statusText, ms, size, headers: list, truncated, binary, contentType,
    body: binary ? '' : new TextDecoder('utf-8').decode(bytes), url: response.url || url.toString()
  }
}

function describeFailure(error: unknown, timeoutMs: number): SendError {
  const name = (error as { name?: string })?.name
  if (name === 'TimeoutError' || name === 'AbortError') return new SendError('timeout', `No complete answer within ${Math.round(timeoutMs / 1000)} seconds`)
  const cause = (error as { cause?: { code?: string; message?: string } })?.cause
  const code = cause?.code ?? (error as { code?: string })?.code ?? ''
  if (TLS_CODES.has(code)) return new SendError('tls', `The server's certificate was not accepted (${code}). OxePost always verifies certificates; trust the certificate on this computer or use the address the certificate was issued for.`)
  if (NETWORK_TEXT[code]) return new SendError('network', NETWORK_TEXT[code]!)
  return new SendError('network', `The request failed${cause?.message ? `: ${cause.message}` : error instanceof Error && error.message !== 'fetch failed' ? `: ${error.message}` : ''}`)
}
