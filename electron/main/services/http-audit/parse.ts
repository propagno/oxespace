import { redactSecrets } from '../../../../shared/secrets'
import { tokenize } from '../conversation/shell-command-rules'
import { parseShell } from '../conversation/shell-parse'

export const HTTP_CALLS_MAX = 50

export type HttpTool = 'curl' | 'wget' | 'httpie' | 'xh' | 'Invoke-RestMethod' | 'Invoke-WebRequest'

export interface HttpCall {
  tool: HttpTool
  method: string
  scheme: 'http' | 'https'
  host: string | null
  port: number
  path: string
  queryKeys: string[]
  headerNames: string[]
  hasBody: boolean
  bodyBytes: number | null
  insecure: boolean
  plainHttpExternal: boolean
}

const SENSITIVE_EXACT = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie'])
const SENSITIVE_SUB = /token|secret|key|auth|session|signature|password|credential/i
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX_LONG_RE = /^[0-9a-f]{16,}$/i
const NUM_RE = /^\d+$/
const SECRET_SEG_RE = /^[A-Za-z0-9_\-:.]{20,}$/
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export function isSensitiveHeaderName(name: string): boolean {
  const clean = name.trim().toLowerCase()
  return SENSITIVE_EXACT.has(clean) || SENSITIVE_SUB.test(clean)
}

function formatHeaderName(raw: string): string {
  const name = raw.trim()
  return isSensitiveHeaderName(name) ? `•••• (${name})` : name
}

function classifySegment(seg: string): string {
  if (!seg) return seg
  if (NUM_RE.test(seg) || UUID_RE.test(seg) || HEX_LONG_RE.test(seg)) return ':id'
  if (SECRET_SEG_RE.test(seg) && /[A-Za-z]/.test(seg) && /\d/.test(seg)) return ':secret'
  return seg
}

export function pathTemplate(rawPath: string): string {
  const p = rawPath.split('?')[0].split('#')[0] || '/'
  if (p === '/') return '/'
  const parts = p.split('/')
  return parts.map((seg, idx) => (idx === 0 && seg === '' ? '' : classifySegment(seg))).join('/') || '/'
}

function parseUrlTarget(raw: string): { scheme: 'http' | 'https'; host: string | null; port: number; path: string; queryKeys: string[] } | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/^\$[A-Za-z_{]/.test(trimmed)) {
    const slash = trimmed.indexOf('/')
    const p = slash >= 0 ? pathTemplate(trimmed.slice(slash)) : '/'
    return { scheme: 'https', host: null, port: 443, path: p, queryKeys: [] }
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : /^[\w.-]+(:\d+)?(\/|$)/.test(trimmed) ? `http://${trimmed}` : null
  if (!withScheme) return null
  try {
    const u = new URL(withScheme)
    const scheme = u.protocol === 'http:' ? 'http' : 'https'
    const host = u.hostname ? u.hostname.toLowerCase() : null
    const port = u.port ? Number(u.port) : scheme === 'http' ? 80 : 443
    const queryKeys: string[] = []
    for (const [k] of u.searchParams) if (!queryKeys.includes(k)) queryKeys.push(k)
    return { scheme, host, port, path: pathTemplate(u.pathname || '/'), queryKeys }
  } catch {
    return null
  }
}

function isPlainExternal(scheme: 'http' | 'https', host: string | null): boolean {
  if (scheme !== 'http' || !host) return false
  return !LOOPBACK.has(host) && !host.startsWith('127.')
}

const CURL_DATA_FLAGS = new Set(['-d', '--data', '--data-raw', '--data-binary', '--data-urlencode', '--json', '-F', '--form'])
const CURL_VALUE_FLAGS = new Set([
  '-X', '--request', '-H', '--header', '-u', '--user', '--oauth2-bearer', '-b', '--cookie', '-E', '--cert', '--proxy-user',
  '-w', '--write-out', '-o', '--output', '-A', '--user-agent', '-e', '--referer', '--connect-timeout', '-m', '--max-time', '--url'
])

function parseCurl(args: string[]): HttpCall | null {
  let method: string | null = null
  let urlRaw: string | null = null
  const headerNames: string[] = []
  let hasBody = false
  let bodyBytes = 0
  let insecure = false

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '-k' || arg === '--insecure') { insecure = true; continue }
    if (arg === '-I' || arg === '--head') { method ??= 'HEAD'; continue }
    if (arg === '-G' || arg === '--get') { method = 'GET'; continue }
    if (arg === '-X' || arg === '--request') { if (i + 1 < args.length) method = args[++i].toUpperCase(); continue }
    if (arg.startsWith('-X') && arg.length > 2) { method = arg.slice(2).toUpperCase(); continue }
    if (arg === '-H' || arg === '--header') {
      if (i + 1 < args.length) {
        const hdr = args[++i]
        const colon = hdr.indexOf(':')
        if (colon > 0) headerNames.push(formatHeaderName(hdr.slice(0, colon)))
      }
      continue
    }
    if (CURL_DATA_FLAGS.has(arg)) {
      hasBody = true
      if (arg === '--json') method ??= 'POST'
      if (i + 1 < args.length) bodyBytes += Buffer.byteLength(args[++i], 'utf8')
      continue
    }
    const eqIdx = arg.indexOf('=')
    if (eqIdx > 0 && CURL_DATA_FLAGS.has(arg.slice(0, eqIdx))) {
      hasBody = true
      bodyBytes += Buffer.byteLength(arg.slice(eqIdx + 1), 'utf8')
      continue
    }
    if (arg === '--url') { if (i + 1 < args.length) urlRaw = args[++i]; continue }
    if (CURL_VALUE_FLAGS.has(arg)) { i += 1; continue }
    if (arg.startsWith('-')) continue
    if (!urlRaw) urlRaw = arg
  }
  if (!urlRaw) return null
  const parsed = parseUrlTarget(urlRaw)
  if (!parsed) return null
  const finalMethod = method ?? (hasBody ? 'POST' : 'GET')
  return {
    tool: 'curl', method: finalMethod, scheme: parsed.scheme, host: parsed.host, port: parsed.port, path: parsed.path,
    queryKeys: parsed.queryKeys, headerNames, hasBody, bodyBytes: hasBody ? bodyBytes : null,
    insecure, plainHttpExternal: isPlainExternal(parsed.scheme, parsed.host)
  }
}

function parseWget(args: string[]): HttpCall | null {
  let method = 'GET'
  let urlRaw: string | null = null
  const headerNames: string[] = []
  let hasBody = false
  let bodyBytes: number | null = null
  let insecure = false

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--no-check-certificate') { insecure = true; continue }
    if (arg.startsWith('--method=')) { method = arg.slice('--method='.length).toUpperCase(); continue }
    if (arg === '--header' && i + 1 < args.length) {
      const hdr = args[++i]
      const colon = hdr.indexOf(':')
      if (colon > 0) headerNames.push(formatHeaderName(hdr.slice(0, colon)))
      continue
    }
    if (arg.startsWith('--header=')) {
      const hdr = arg.slice('--header='.length)
      const colon = hdr.indexOf(':')
      if (colon > 0) headerNames.push(formatHeaderName(hdr.slice(0, colon)))
      continue
    }
    if (arg.startsWith('--post-data=')) {
      hasBody = true; method = 'POST'; bodyBytes = Buffer.byteLength(arg.slice('--post-data='.length), 'utf8'); continue
    }
    if ((arg === '--post-data' || arg === '--body-data') && i + 1 < args.length) {
      hasBody = true; method = 'POST'; bodyBytes = Buffer.byteLength(args[++i], 'utf8'); continue
    }
    if ((arg === '-O' || arg === '--output-document' || arg === '--password' || arg === '--http-password' || arg === '--user' || arg === '--http-user') && i + 1 < args.length) {
      i += 1; continue
    }
    if (arg.startsWith('-')) continue
    if (!urlRaw) urlRaw = arg
  }
  if (!urlRaw) return null
  const parsed = parseUrlTarget(urlRaw)
  if (!parsed) return null
  return {
    tool: 'wget', method, scheme: parsed.scheme, host: parsed.host, port: parsed.port, path: parsed.path,
    queryKeys: parsed.queryKeys, headerNames, hasBody, bodyBytes, insecure,
    plainHttpExternal: isPlainExternal(parsed.scheme, parsed.host)
  }
}

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

function parseHttpie(toolName: 'httpie' | 'xh', defaultHttps: boolean, args: string[]): HttpCall | null {
  let method: string | null = null
  let urlRaw: string | null = null
  const headerNames: string[] = []
  const queryKeys: string[] = []
  let hasBody = false
  let bodyBytes = 0
  let insecure = false

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--verify=no' || arg === '--verify=false') { insecure = true; continue }
    if ((arg === '--verify' || arg === '-a' || arg === '--auth' || arg === '-o' || arg === '--output') && i + 1 < args.length) {
      const val = args[++i]
      if (arg === '--verify' && (val === 'no' || val === 'false')) insecure = true
      continue
    }
    if (arg.startsWith('-')) continue
    if (!urlRaw && !method && HTTP_METHODS.has(arg.toUpperCase())) {
      method = arg.toUpperCase(); continue
    }
    if (!urlRaw) {
      urlRaw = !/^https?:\/\//i.test(arg) && defaultHttps ? `https://${arg}` : arg
      continue
    }
    const colonEq = arg.indexOf(':=')
    const eqEq = arg.indexOf('==')
    const eq = arg.indexOf('=')
    const colon = arg.indexOf(':')
    if (eqEq > 0) {
      const k = arg.slice(0, eqEq)
      if (!queryKeys.includes(k)) queryKeys.push(k)
    } else if (colonEq > 0) {
      hasBody = true
      bodyBytes += Buffer.byteLength(arg.slice(colonEq + 2), 'utf8')
    } else if (eq > 0 && (colon < 0 || eq < colon)) {
      hasBody = true
      bodyBytes += Buffer.byteLength(arg.slice(eq + 1), 'utf8')
    } else if (colon > 0) {
      headerNames.push(formatHeaderName(arg.slice(0, colon)))
    }
  }
  if (!urlRaw) return null
  const parsed = parseUrlTarget(urlRaw)
  if (!parsed) return null
  for (const k of parsed.queryKeys) if (!queryKeys.includes(k)) queryKeys.push(k)
  return {
    tool: toolName, method: method ?? (hasBody ? 'POST' : 'GET'),
    scheme: parsed.scheme, host: parsed.host, port: parsed.port, path: parsed.path,
    queryKeys, headerNames, hasBody, bodyBytes: hasBody ? bodyBytes : null,
    insecure, plainHttpExternal: isPlainExternal(parsed.scheme, parsed.host)
  }
}

const WRAPPERS = new Set(['sudo', 'env', 'time', 'command', 'nohup'])
const VAR_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/

function unwrapTokens(tokens: string[]): { cmd: string; args: string[] } | { nested: string } | null {
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (VAR_ASSIGN.test(t)) { i += 1; continue }
    const base = t.replace(/^.*[/\\]/, '').replace(/\.exe$/i, '').toLowerCase()
    if (WRAPPERS.has(base)) {
      i += 1
      while (i < tokens.length && (tokens[i].startsWith('-') || (base === 'env' && VAR_ASSIGN.test(tokens[i])))) i += 1
      continue
    }
    if (base === 'timeout') {
      i += 1
      while (i < tokens.length && tokens[i].startsWith('-')) i += 1
      if (i < tokens.length) i += 1 // duration
      continue
    }
    if ((base === 'bash' || base === 'sh' || base === 'zsh') && i + 2 < tokens.length && /^-[a-z]*c[a-z]*$/i.test(tokens[i + 1])) {
      return { nested: tokens[i + 2] }
    }
    return { cmd: base, args: tokens.slice(i + 1) }
  }
  return null
}

function splitFallback(command: string): string[] {
  const parts: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i]
    if (quote) {
      if (ch === quote) quote = null
      else if (ch === '\\' && quote === '"' && i + 1 < command.length) { cur += ch + command[++i]; continue }
      cur += ch; continue
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue }
    const two = command.slice(i, i + 2)
    if (two === '&&' || two === '||') { parts.push(cur); cur = ''; i += 1; continue }
    if (ch === ';' || ch === '|' || ch === '\n') { parts.push(cur); cur = ''; continue }
    cur += ch
  }
  parts.push(cur)
  return parts.map(p => p.trim()).filter(Boolean)
}

function parseBashCalls(command: string, depth = 0): HttpCall[] {
  if (depth > 3 || !command.trim()) return []
  const parsed = parseShell(command)
  const subcommands = parsed && !parsed.unanalysable && parsed.commands.length > 0 ? parsed.commands : splitFallback(command)
  const out: HttpCall[] = []
  for (const sub of subcommands) {
    if (out.length >= HTTP_CALLS_MAX) break
    const tokens = tokenize(sub).filter(t => !/^[<>]|^\d+[<>]/.test(t))
    const unwrapped = unwrapTokens(tokens)
    if (!unwrapped) continue
    if ('nested' in unwrapped) {
      for (const call of parseBashCalls(unwrapped.nested, depth + 1)) {
        if (out.length >= HTTP_CALLS_MAX) break
        out.push(call)
      }
      continue
    }
    const { cmd, args } = unwrapped
    let call: HttpCall | null = null
    if (cmd === 'curl') call = parseCurl(args)
    else if (cmd === 'wget') call = parseWget(args)
    else if (cmd === 'http' || cmd === 'https') call = parseHttpie('httpie', cmd === 'https', args)
    else if (cmd === 'xh' || cmd === 'xhs') call = parseHttpie('xh', cmd === 'xhs', args)
    if (call) out.push(call)
  }
  return out
}

function parsePowershellHeaders(block: string): string[] {
  const names: string[] = []
  const re = /(?:'([^']+)'|"([^"]+)"|([A-Za-z0-9_-]+))\s*=/g
  for (let m = re.exec(block); m !== null; m = re.exec(block)) {
    const key = m[1] ?? m[2] ?? m[3]
    if (key) names.push(formatHeaderName(key))
  }
  return names
}

function parsePowershellCalls(command: string): HttpCall[] {
  const out: HttpCall[] = []
  const segments = splitFallback(command)
  for (const seg of segments) {
    if (out.length >= HTTP_CALLS_MAX) break
    const m = /^\s*(Invoke-RestMethod|Invoke-WebRequest|irm|iwr)\b([\s\S]*)$/i.exec(seg)
    if (!m) continue
    const rawTool = m[1].toLowerCase()
    const tool: HttpTool = rawTool === 'irm' || rawTool === 'invoke-restmethod' ? 'Invoke-RestMethod' : 'Invoke-WebRequest'
    let rest = m[2]
    const headerNames: string[] = []
    rest = rest.replace(/-Headers\s*@\{([^}]*)\}/gi, (_full, inner: string) => {
      headerNames.push(...parsePowershellHeaders(inner))
      return ' '
    })
    const tokens = tokenize(rest)
    let method = 'GET'
    let urlRaw: string | null = null
    let hasBody = false
    let bodyBytes: number | null = null
    let insecure = false
    for (let i = 0; i < tokens.length; i += 1) {
      const t = tokens[i]
      const low = t.toLowerCase()
      if (low === '-skipcertificatecheck') { insecure = true; continue }
      if (low === '-method' && i + 1 < tokens.length) { method = tokens[++i].toUpperCase(); continue }
      if (low === '-uri' && i + 1 < tokens.length) { urlRaw = tokens[++i]; continue }
      if (low === '-body' && i + 1 < tokens.length) {
        hasBody = true; bodyBytes = Buffer.byteLength(tokens[++i], 'utf8'); continue
      }
      if ((low === '-credential' || low === '-token' || low === '-authentication' || low === '-outfile' || low === '-contenttype') && i + 1 < tokens.length) {
        i += 1; continue
      }
      if (t.startsWith('-')) continue
      if (!urlRaw) urlRaw = t
    }
    if (!urlRaw) continue
    const parsed = parseUrlTarget(urlRaw)
    if (!parsed) continue
    out.push({
      tool, method, scheme: parsed.scheme, host: parsed.host, port: parsed.port, path: parsed.path,
      queryKeys: parsed.queryKeys, headerNames, hasBody, bodyBytes, insecure,
      plainHttpExternal: isPlainExternal(parsed.scheme, parsed.host)
    })
  }
  return out
}

export function parseHttpCalls(command: string, shell: 'bash' | 'powershell' = 'bash'): HttpCall[] {
  if (!command || typeof command !== 'string') return []
  try {
    return (shell === 'powershell' ? parsePowershellCalls(command) : parseBashCalls(command)).slice(0, HTTP_CALLS_MAX)
  } catch {
    return []
  }
}

export function statusFromOutput(stdoutHead: string): number | null {
  if (!stdoutHead || typeof stdoutHead !== 'string') return null
  const statusLines = [...stdoutHead.matchAll(/HTTP\/\d(?:\.\d)?\s+([1-5]\d\d)\b/g)]
  if (statusLines.length > 0) return Number(statusLines[statusLines.length - 1][1])
  const trimmed = stdoutHead.trimEnd()
  const tail = /(?:^|[^0-9])([1-5]\d\d)$/.exec(trimmed)
  if (tail) return Number(tail[1])
  return null
}

function redactUrlInCommand(rawUrl: string): string {
  try {
    const u = new URL(rawUrl)
    const auth = u.username || u.password ? '••••@' : ''
    const port = u.port ? `:${u.port}` : ''
    const path = pathTemplate(u.pathname || '/')
    const params: string[] = []
    for (const [k] of u.searchParams) params.push(`${k}=••••`)
    const search = params.length > 0 ? `?${params.join('&')}` : ''
    return `${u.protocol}//${auth}${u.hostname}${port}${path}${search}`
  } catch {
    return rawUrl.replace(/([a-z]+:\/\/)[^\s/@]+@/i, '$1••••@')
  }
}

export function redactCommand(command: string, _shell: 'bash' | 'powershell' = 'bash'): string {
  if (!command || typeof command !== 'string') return ''
  // URLs with userinfo, path secrets, or query strings
  let out = command.replace(/https?:\/\/[^\s"'`]+/gi, match => redactUrlInCommand(match))
  out = redactSecrets(out)
  // Inline environment assignments: NAME=value or export NAME=value
  out = out.replace(/\b(export\s+)?([A-Za-z_][A-Za-z0-9_]*)=('[^']*'|"[^"]*"|\S+)/g, (_m, exp: string | undefined, name: string) => `${exp ?? ''}${name}=••••`)
  // curl / httpie / wget body & credential flags
  out = out.replace(/(\s(?:-(?:d|F|u|b|E|a)|--(?:data(?:-raw|-binary|-urlencode)?|json|form|user|oauth2-bearer|cookie|cert|proxy-user|password|http-password))\s*=?)\s*('[^']*'|"[^"]*"|\S+)/g, '$1••••')
  // Header values in -H / --header
  out = out.replace(/((?:-H|--header)\s*=?\s*)(?:'([^:'"]+):[^']*'|\"([^:'"]+):[^\"]*\"|([A-Za-z0-9_-]+):\S+)/g, (_m, flag: string, h1?: string, h2?: string, h3?: string) => `${flag}'${h1 ?? h2 ?? h3 ?? 'Header'}: ••••'`)
  // PowerShell -Body, -Token, -Credential
  out = out.replace(/(-(?:Body|Token|Credential)\s+)('[^']*'|"[^"]*"|\S+)/gi, '$1••••')
  // PowerShell -Headers @{ ... }
  out = out.replace(/(-Headers\s*@\{)[^}]*(\})/gi, '$1••••$2')
  // HTTPie header:value, field=value, field:=value tokens
  out = out.replace(/(\s)([A-Za-z0-9_.-]+)(:=|==|=|:)('[^']*'|"[^"]*"|\S+)/g, (_m, sp: string, key: string, op: string, val: string) => {
    if (key === 'http' || key === 'https' && val.startsWith('//')) return _m
    return `${sp}${key}${op}••••`
  })
  return out
}
