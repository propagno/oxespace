import { HTTP_METHODS, type HttpMethod, type PostAuth, type PostHeader, type PostRequest } from './types'

/** Splits a shell command line into words: quotes, `$'…'`, backslash escapes and line continuations (`\` and `^`). */
export function shellWords(input: string): string[] {
  const text = input.replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' ')
  const words: string[] = []
  let current = '', started = false
  const push = (): void => { if (started) words.push(current); current = ''; started = false }
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (/\s/.test(char)) { push(); continue }
    started = true
    if (char === "'") {
      const end = text.indexOf("'", index + 1)
      current += text.slice(index + 1, end < 0 ? text.length : end)
      index = end < 0 ? text.length : end
    } else if (char === '$' && text[index + 1] === "'") {
      index += 2
      for (; index < text.length && text[index] !== "'"; index++) {
        if (text[index] === '\\' && index + 1 < text.length) {
          const next = text[++index]!
          current += next === 'n' ? '\n' : next === 't' ? '\t' : next === 'r' ? '\r' : next
        } else current += text[index]
      }
    } else if (char === '"') {
      for (index++; index < text.length && text[index] !== '"'; index++) {
        if (text[index] === '\\' && /["\\$`]/.test(text[index + 1] ?? '')) index++
        current += text[index]
      }
    } else if (char === '\\' && index + 1 < text.length) current += text[++index]
    else current += char
  }
  push()
  return words
}

export interface CurlImport { request: PostRequest; warnings: string[] }

const WITH_VALUE = new Set(['-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode', '--json', '-u', '--user', '-A', '--user-agent', '-e', '--referer', '-b', '--cookie', '--url', '-F', '--form', '-m', '--max-time', '--connect-timeout', '-o', '--output', '-x', '--proxy', '--cacert', '--cert', '--key', '-w', '--write-out', '-T', '--upload-file', '--retry', '-K', '--config', '--resolve', '--oauth2-bearer'])
const DATA_FLAGS = new Set(['-d', '--data', '--data-raw', '--data-binary', '--data-ascii'])
const IGNORED = new Set(['-L', '--location', '-s', '--silent', '-S', '--show-error', '-v', '--verbose', '-i', '--include', '--compressed', '-f', '--fail', '-g', '--globoff', '--http1.1', '--http2', '-N', '--no-buffer', '-#', '--progress-bar', '-O', '-J'])

/** Reads a cURL command (as copied from a browser's "Copy as cURL", bash or cmd flavor) into a request. */
export function parseCurl(command: string): CurlImport {
  const words = shellWords(command.trim())
  const warnings: string[] = []
  if (words[0]?.toLowerCase().replace(/\.exe$/, '') === 'curl') words.shift()
  if (words.length === 0) throw new Error('This is not a cURL command')
  let method: string | undefined, url = '', head = false, getMode = false
  const headers: PostHeader[] = []
  const data: string[] = []
  const urlencoded: string[] = []
  let user: string | undefined, json = false, bearer: string | undefined

  for (let index = 0; index < words.length; index++) {
    let word = words[index]!
    let attached: string | undefined
    const eq = /^(--[a-z0-9-]+)=(.*)$/s.exec(word)
    if (eq) { word = eq[1]!; attached = eq[2]! }
    else if (/^-[A-Za-z]./.test(word) && !word.startsWith('--') && WITH_VALUE.has(word.slice(0, 2))) { attached = word.slice(2); word = word.slice(0, 2) }
    else if (/^-[A-Za-z]{2,}$/.test(word)) {
      // A cluster of flags without values: -sSL
      for (const letter of word.slice(1)) {
        if (letter === 'I') head = true
        else if (letter === 'G') getMode = true
        else if (letter === 'k') warnings.push('-k (skip certificate checks) was ignored: OxePost always verifies TLS')
      }
      continue
    }
    const value = (): string => attached ?? words[++index] ?? ''
    if (word === '-X' || word === '--request') method = value().toUpperCase()
    else if (word === '-H' || word === '--header') {
      const header = /^([^:]+):\s?(.*)$/s.exec(value())
      if (header) headers.push({ name: header[1]!.trim(), value: header[2]!.trim(), enabled: true })
    } else if (DATA_FLAGS.has(word)) data.push(value())
    else if (word === '--data-urlencode') urlencoded.push(value())
    else if (word === '--json') { json = true; data.push(value()) }
    else if (word === '-u' || word === '--user') user = value()
    else if (word === '--oauth2-bearer') bearer = value()
    else if (word === '-A' || word === '--user-agent') headers.push({ name: 'User-Agent', value: value(), enabled: true })
    else if (word === '-e' || word === '--referer') headers.push({ name: 'Referer', value: value(), enabled: true })
    else if (word === '-b' || word === '--cookie') headers.push({ name: 'Cookie', value: value(), enabled: true })
    else if (word === '--url') url = value()
    else if (word === '-I' || word === '--head') head = true
    else if (word === '-G' || word === '--get') getMode = true
    else if (word === '-k' || word === '--insecure') warnings.push('-k (skip certificate checks) was ignored: OxePost always verifies TLS')
    else if (word === '-F' || word === '--form') { warnings.push('Multipart form fields (-F) are not supported yet and were left out'); value() }
    else if (WITH_VALUE.has(word)) { warnings.push(`${word} was ignored`); value() }
    else if (IGNORED.has(word)) continue
    else if (word.startsWith('-') && word.length > 1) warnings.push(`${word} was ignored`)
    else if (!url) url = word
  }
  if (!url) throw new Error('The cURL command has no URL')

  let body = [...data, ...urlencoded.map(item => { const eq2 = item.indexOf('='); return eq2 < 0 ? encodeURIComponent(item) : `${item.slice(0, eq2)}=${encodeURIComponent(item.slice(eq2 + 1))}` })].join('&')
  if (getMode && body) { url += (url.includes('?') ? '&' : '?') + body; body = '' }
  let chosen = (head ? 'HEAD' : method ?? (body ? 'POST' : 'GET')).toUpperCase()
  if (!(HTTP_METHODS as readonly string[]).includes(chosen)) { warnings.push(`The method ${chosen} is not supported; GET was used`); chosen = 'GET' }
  if (json) {
    if (!headers.some(header => header.name.toLowerCase() === 'content-type')) headers.push({ name: 'Content-Type', value: 'application/json', enabled: true })
    if (!headers.some(header => header.name.toLowerCase() === 'accept')) headers.push({ name: 'Accept', value: 'application/json', enabled: true })
  } else if (body && !headers.some(header => header.name.toLowerCase() === 'content-type')) {
    headers.push({ name: 'Content-Type', value: 'application/x-www-form-urlencoded', enabled: true })
  }

  let auth: PostAuth = { type: 'none' }
  const authIndex = headers.findIndex(header => header.name.toLowerCase() === 'authorization')
  if (bearer !== undefined) auth = { type: 'bearer', token: bearer }
  else if (user !== undefined) { const colon = user.indexOf(':'); auth = { type: 'basic', username: colon < 0 ? user : user.slice(0, colon), password: colon < 0 ? '' : user.slice(colon + 1) } }
  else if (authIndex >= 0) {
    const value = headers[authIndex]!.value
    const bearerMatch = /^bearer\s+(.+)$/i.exec(value), basicMatch = /^basic\s+(.+)$/i.exec(value)
    if (bearerMatch) { auth = { type: 'bearer', token: bearerMatch[1]! }; headers.splice(authIndex, 1) }
    else if (basicMatch) {
      const decoded = decodeBase64(basicMatch[1]!), colon = decoded.indexOf(':')
      if (colon >= 0) { auth = { type: 'basic', username: decoded.slice(0, colon), password: decoded.slice(colon + 1) }; headers.splice(authIndex, 1) }
    }
  }
  if (auth.type !== 'none' && authLooksLiteral(auth)) warnings.push('The command carries a credential. Replace it with a {{variable}} and keep the value in an environment secret before saving')
  const request: PostRequest = { name: nameFor(chosen as HttpMethod, url), method: chosen as HttpMethod, url, headers, auth, body }
  return { request, warnings }
}

function decodeBase64(value: string): string {
  try { return typeof atob === 'function' ? new TextDecoder().decode(Uint8Array.from(atob(value), char => char.charCodeAt(0))) : Buffer.from(value, 'base64').toString('utf8') } catch { return '' }
}

function authLooksLiteral(auth: PostAuth): boolean {
  const literal = (value: string): boolean => value !== '' && !/^\{\{.*\}\}$/.test(value.trim())
  return auth.type === 'bearer' ? literal(auth.token) : auth.type === 'basic' ? literal(auth.password) : auth.type === 'apikey' ? literal(auth.value) : false
}

function nameFor(method: HttpMethod, url: string): string {
  const path = url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '').replace(/[?#].*$/, '') || '/'
  return `${method} ${path}`.slice(0, 80)
}

const quote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

/** The request as a cURL command (bash). `{{variables}}` stay as they are, unless `values` resolves them. */
export function toCurl(request: PostRequest, values?: Readonly<Record<string, string>>): string {
  const fill = (text: string): string => values ? text.replace(/\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g, (whole, name: string) => Object.prototype.hasOwnProperty.call(values, name) ? values[name]! : whole) : text
  let url = fill(request.url)
  const headers = request.headers.filter(header => header.enabled && header.name.trim()).map(header => `${header.name}: ${fill(header.value)}`)
  const parts: string[] = ['curl']
  if (request.method === 'HEAD') parts.push('-I')
  else if (request.method !== 'GET') parts.push('-X', request.method)
  const auth = request.auth
  if (auth.type === 'bearer') headers.push(`Authorization: Bearer ${fill(auth.token)}`)
  else if (auth.type === 'apikey' && auth.in === 'header') headers.push(`${auth.name}: ${fill(auth.value)}`)
  else if (auth.type === 'apikey') url += `${url.includes('?') ? '&' : '?'}${encodeURIComponent(fill(auth.name))}=${encodeURIComponent(fill(auth.value))}`
  parts.push(quote(url))
  if (auth.type === 'basic') parts.push('-u', quote(`${fill(auth.username)}:${fill(auth.password)}`))
  for (const header of headers) parts.push('-H', quote(header))
  if (request.body !== '') parts.push('--data-raw', quote(fill(request.body)))
  return parts.join(' ')
}
