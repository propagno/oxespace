import { HTTP_METHODS, PostFormatError, type HttpMethod, type PostAuth, type PostHeader, type PostRequest } from './types'

/**
 * The request file format (`.oxespace/requests/**\/*.http`), meant to be read and reviewed in a pull request:
 *
 *     # name: Get a user
 *     # description: One line, optional.
 *     # auth: bearer {{token}}
 *     GET {{baseUrl}}/users/{{id}}?expand=roles
 *     Accept: application/json
 *     #! X-Debug: 1
 *
 *     {"optional": "body, after the first blank line"}
 *
 * - Lines starting with `# ` before the request line are metadata (`name`, `description`, `auth`); other
 *   comment lines there are ignored.
 * - The request line is `METHOD URL`; `HTTP/1.1` after the URL is tolerated and dropped.
 * - Headers are `Name: value`; `#! Name: value` is a header that is switched off.
 * - `auth` is `none`, `bearer <token>`, `basic <username> <password>` (the username has no spaces) or
 *   `apikey header|query <name> <value>`. Write `{{variables}}` here, never a literal secret: the file is
 *   committed. Secrets live in an environment, in the system's secure storage.
 * - Everything after the first blank line that follows the request line is the body, byte for byte.
 */

const META = /^#\s*(name|description|auth)\s*:\s?(.*)$/i

export function serializeRequest(request: PostRequest): string {
  const oneLine = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim()
  const lines: string[] = [`# name: ${oneLine(request.name) || 'Untitled'}`]
  if (request.description && oneLine(request.description)) lines.push(`# description: ${oneLine(request.description)}`)
  const auth = serializeAuth(request.auth)
  if (auth) lines.push(`# auth: ${auth}`)
  lines.push(`${request.method} ${oneLine(request.url)}`)
  for (const header of request.headers) {
    const name = oneLine(header.name)
    if (!name) continue
    lines.push(`${header.enabled ? '' : '#! '}${name}: ${oneLine(header.value)}`)
  }
  let text = lines.join('\n')
  if (request.body !== '') text += `\n\n${request.body.replace(/\r\n/g, '\n')}`
  return `${text}\n`
}

function serializeAuth(auth: PostAuth): string {
  const token = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim()
  switch (auth.type) {
    case 'none': return ''
    case 'bearer': return `bearer ${token(auth.token)}`.trim()
    case 'basic': return `basic ${token(auth.username).replace(/\s+/g, '%20')} ${token(auth.password)}`.trim()
    case 'apikey': return `apikey ${auth.in} ${token(auth.name).replace(/\s+/g, '')} ${token(auth.value)}`.trim()
  }
}

function parseAuth(value: string, line: number): PostAuth {
  const text = value.trim()
  if (!text || text === 'none') return { type: 'none' }
  const bearer = /^bearer(?:\s+(.*))?$/i.exec(text)
  if (bearer) return { type: 'bearer', token: bearer[1]?.trim() ?? '' }
  const basic = /^basic(?:\s+(\S+))?(?:\s+(.*))?$/i.exec(text)
  if (basic) return { type: 'basic', username: (basic[1] ?? '').replace(/%20/g, ' '), password: basic[2]?.trim() ?? '' }
  const key = /^apikey\s+(header|query)\s+(\S+)(?:\s+(.*))?$/i.exec(text)
  if (key) return { type: 'apikey', in: key[1]!.toLowerCase() as 'header' | 'query', name: key[2]!, value: key[3]?.trim() ?? '' }
  throw new PostFormatError(`Unknown auth "${text.split(/\s+/)[0]}"; use none, bearer, basic or apikey`, line)
}

export function parseRequest(text: string): PostRequest {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const request: PostRequest = { name: '', method: 'GET', url: '', headers: [], auth: { type: 'none' }, body: '' }
  let index = 0
  // Metadata, comments and blank lines until the request line.
  for (; index < lines.length; index++) {
    const raw = lines[index]!
    if (!raw.trim()) continue
    if (raw.startsWith('#')) {
      const meta = META.exec(raw)
      if (meta) {
        const key = meta[1]!.toLowerCase()
        if (key === 'name') request.name = meta[2]!.trim()
        else if (key === 'description') request.description = meta[2]!.trim()
        else request.auth = parseAuth(meta[2]!, index + 1)
      }
      continue
    }
    break
  }
  if (index >= lines.length) throw new PostFormatError('There is no request line (METHOD URL)')
  const start = /^([A-Za-z]+)\s+(\S.*?)(?:\s+HTTP\/\d(?:\.\d)?)?\s*$/.exec(lines[index]!)
  const method = start?.[1]?.toUpperCase()
  if (!start || !(HTTP_METHODS as readonly string[]).includes(method!)) throw new PostFormatError(`Expected "METHOD URL", with a method among ${HTTP_METHODS.join(', ')}`, index + 1)
  request.method = method as HttpMethod
  request.url = start[2]!.trim()
  index++
  for (; index < lines.length; index++) {
    const raw = lines[index]!
    if (!raw.trim()) { index++; break }
    const disabled = raw.startsWith('#!')
    const header = /^([^\s:][^:]*):\s?(.*)$/.exec(disabled ? raw.slice(2).trimStart() : raw)
    if (!header) throw new PostFormatError('Expected a header as "Name: value"', index + 1)
    request.headers.push({ name: header[1]!.trim(), value: header[2]!.trim(), enabled: !disabled })
  }
  request.body = lines.slice(index).join('\n').replace(/\n$/, '')
  if (!request.name) request.name = `${request.method} ${request.url}`.slice(0, 80)
  return request
}

/** A file name for a request: lowercase letters, digits and dashes. */
export function slugify(name: string): string {
  const slug = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return slug || 'request'
}

/** A blank request. Its name is interface text, so the window passes it in the language on screen. */
export const emptyRequest = (name: string): PostRequest => ({ name, method: 'GET', url: '', headers: [], auth: { type: 'none' }, body: '' })

export function headerValue(headers: PostHeader[], name: string): string | undefined {
  const wanted = name.toLowerCase()
  return headers.find(header => header.enabled && header.name.toLowerCase() === wanted)?.value
}

/** The auth values written as literals rather than `{{variables}}`: the file would carry a secret. */
export function literalSecrets(request: PostRequest): string[] {
  const literal = (value: string): boolean => value.trim() !== '' && !/^\{\{\s*[A-Za-z_][\w.-]*\s*\}\}$/.test(value.trim())
  const auth = request.auth
  if (auth.type === 'bearer') return literal(auth.token) ? ['token'] : []
  if (auth.type === 'basic') return literal(auth.password) ? ['password'] : []
  if (auth.type === 'apikey') return literal(auth.value) ? ['value'] : []
  return []
}
