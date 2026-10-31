import { HTTP_METHODS, LIMITS, type HttpMethod, type PostAuth, type PostEnvironment, type PostHeader, type PostRequest } from './types'
import { isSensitiveName } from './redact'

/** What arrives over IPC is untrusted: these read it into the real shapes or say what is wrong with it. */
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, label: string, max: number, optional = false): string => {
  if (value === undefined && optional) return ''
  if (typeof value !== 'string' || value.includes('\0')) throw new Error(`${label} must be text`)
  if (value.length > max) throw new Error(`${label} is too long (at most ${max} characters)`)
  return value
}

export function coerceRequest(value: unknown): PostRequest {
  if (!isObject(value)) throw new Error('The request is missing')
  const method = String(value.method ?? 'GET').toUpperCase()
  if (!(HTTP_METHODS as readonly string[]).includes(method)) throw new Error(`The method must be one of ${HTTP_METHODS.join(', ')}`)
  const headers: PostHeader[] = []
  if (value.headers !== undefined) {
    if (!Array.isArray(value.headers) || value.headers.length > 100) throw new Error('A request has at most 100 headers')
    for (const item of value.headers) {
      if (!isObject(item)) throw new Error('A header must be an object')
      headers.push({ name: text(item.name, 'A header name', 200), value: text(item.value, 'A header value', 16_384, true), enabled: item.enabled !== false })
    }
  }
  const body = text(value.body, 'The body', LIMITS.requestBodyBytes, true)
  const description = text(value.description, 'The description', 500, true)
  return {
    name: text(value.name, 'The name', 200, true) || 'Untitled', method: method as HttpMethod, url: text(value.url, 'The URL', 16_384, true),
    headers, auth: coerceAuth(value.auth), body, ...(description ? { description } : {})
  }
}

function coerceAuth(value: unknown): PostAuth {
  if (value === undefined || value === null) return { type: 'none' }
  if (!isObject(value)) throw new Error('The authentication must be an object')
  switch (value.type) {
    case 'none': return { type: 'none' }
    case 'bearer': return { type: 'bearer', token: text(value.token, 'The token', 8192, true) }
    case 'basic': return { type: 'basic', username: text(value.username, 'The username', 1024, true), password: text(value.password, 'The password', 4096, true) }
    case 'apikey':
      if (value.in !== 'header' && value.in !== 'query') throw new Error('The API key goes in the header or the query')
      return { type: 'apikey', in: value.in, name: text(value.name, 'The API key name', 200, true), value: text(value.value, 'The API key', 8192, true) }
    default: throw new Error('Unknown authentication')
  }
}

const VARIABLE_NAME = /^[A-Za-z_][\w.-]{0,63}$/

export function isVariableName(value: string): boolean { return VARIABLE_NAME.test(value) }

/** An environment as the page sends it. A variable that looks like a credential must be a secret: the file is committed. */
export function coerceEnvironment(value: unknown): PostEnvironment {
  if (!isObject(value)) throw new Error('The environment is missing')
  const name = text(value.name, 'The environment name', 60).trim()
  if (!name) throw new Error('The environment needs a name')
  const variables: Record<string, string> = {}
  if (value.variables !== undefined) {
    if (!isObject(value.variables)) throw new Error('The variables must be an object')
    const entries = Object.entries(value.variables)
    if (entries.length > 200) throw new Error('An environment has at most 200 variables')
    for (const [key, raw] of entries) {
      if (!VARIABLE_NAME.test(key)) throw new Error(`"${key}" is not a valid variable name (letters, digits, _ . -)`)
      const content = text(raw, `The value of ${key}`, 4096, true)
      if (isSensitiveName(key) && content !== '') throw new Error(`"${key}" looks like a credential: make it a secret, which is kept in the system's secure storage and not in the file`)
      variables[key] = content
    }
  }
  const secrets = Array.isArray(value.secrets) ? [...new Set(value.secrets.map(item => text(item, 'A secret name', 64)))] : []
  if (secrets.length > 50) throw new Error('An environment has at most 50 secrets')
  for (const secret of secrets) { if (!VARIABLE_NAME.test(secret)) throw new Error(`"${secret}" is not a valid secret name`); if (secret in variables) throw new Error(`"${secret}" is both a variable and a secret`) }
  return { id: '', name, production: value.production === true, variables, secrets }
}

/** A path inside `.oxespace/requests`, with `/` separators: folders and a `.http` file, nothing that climbs out. */
export function requestPathSegments(value: unknown): string[] {
  if (typeof value !== 'string' || !value || value.length > 300 || value.includes('\0') || value.includes('\\')) throw new Error('The request path is not valid')
  const segments = value.split('/')
  if (segments.length > LIMITS.depth) throw new Error('Requests can be nested four folders deep at most')
  for (const segment of segments) if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/.test(segment) || segment.endsWith('.') || segment.endsWith(' ')) throw new Error('The request path is not valid')
  if (!segments[segments.length - 1]!.endsWith('.http')) throw new Error('A request file ends in .http')
  if (segments[0] === 'environments') throw new Error('The request path is not valid')
  return segments
}

/** A folder name from the page: segments as above, no file. */
export function folderSegments(value: unknown): string[] {
  if (value === undefined || value === '') return []
  if (typeof value !== 'string' || value.length > 200 || value.includes('\\') || value.includes('\0')) throw new Error('The folder is not valid')
  const segments = value.split('/').filter(Boolean)
  if (segments.length >= LIMITS.depth) throw new Error('Requests can be nested four folders deep at most')
  for (const segment of segments) if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/.test(segment) || segment.endsWith(' ')) throw new Error('The folder is not valid')
  if (segments[0] === 'environments') throw new Error('The folder is not valid')
  return segments
}
