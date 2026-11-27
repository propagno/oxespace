import { redactSecrets } from '../../../shared/secrets'
import type { ToolRowKind } from '../../../shared/thread-tool-rows'
import type { ThreadEvent } from '../../../shared/types/thread'
import { normalizeRootPath } from '../../../shared/utils/path'

type Tool = Extract<ThreadEvent, { type: 'tool' }>

const SUMMARY_LIMIT = 140
const TRAILING_PUNCT = /[.,;:!?)\]}]+$/

function normalizeFsPath(rawPath: string): string {
  if (!rawPath) return ''
  let value = rawPath
  if (/^file:\/\//i.test(value)) {
    value = value.replace(/^file:\/\/(?:localhost)?/i, '')
    try { value = decodeURIComponent(value) } catch { /* keep raw URI text */ }
  }
  return value
    .replace(/\\/g, '/')
    .replace(/^\/\/\?\/(?=[A-Za-z]:(?:\/|$))/, '')
    .replace(/^\/+(?=[A-Za-z]:(?:\/|$))/, '')
}

function relativizeCommandPaths(text: string, root: string): string {
  if (!text || !root) return text
  const base = normalizeRootPath(normalizeFsPath(root))
  if (!base || base === '/') return text
  const ci = /^[A-Za-z]:/.test(base)
  const escaped = base
    .split('/')
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\\\/]+')
  const lead = ci
    ? '(?:file:\\/\\/(?:localhost)?[\\\\/]+|(?:(?<=^|[\\s"\'`=(;,])[\\\\/]+))?'
    : '(?:file:\\/\\/(?:localhost)?)?'
  const re = new RegExp(`${lead}${escaped}(?:[\\\\/]+([^\\s"'\`<>|\\u0000-\\u001f]+)|(?=$|[\\s"'\`<>|.,;:!?)\\]}]))`, ci ? 'gi' : 'g')
  return text.replace(re, (_match, rest: string | undefined) => {
    if (!rest) return '.'
    const trail = TRAILING_PUNCT.exec(rest)?.[0] ?? ''
    const body = trail ? rest.slice(0, -trail.length) : rest
    if (!body) return `.${trail}`
    const normalized = body.replace(/[\\/]+/g, '/').replace(/^\/+/, '')
    if (!normalized || normalized.split('/').includes('..')) return `.${trail}`
    return `${normalized}${trail}`
  })
}

function parseToolJson(detail: string): Record<string, unknown> | undefined {
  const trimmed = detail.trim()
  if (!trimmed.startsWith('{')) return undefined
  try {
    const parsed = JSON.parse(trimmed)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/** Extracts the complete redacted raw target (full path or full shell command) for tooltips and expanded inspection. */
export function extractRawToolTarget(event: Tool, kind: ToolRowKind): string {
  if (kind === 'edit' && event.files?.[0]?.path) {
    return redactSecrets(normalizeFsPath(event.files[0].path))
  }
  const input = parseToolJson(event.detail ?? '')
  if (input) {
    const keys = kind === 'run'
      ? ['command', 'cmd', 'description']
      : kind === 'read' || kind === 'edit'
        ? ['file_path', 'notebook_path', 'path', 'pattern', 'query']
        : ['sql', 'url', 'query', 'command', 'file_path', 'path', 'description']
    for (const key of keys) {
      const value = input[key]
      if (typeof value === 'string' && value.trim()) {
        const cleaned = kind === 'read' || kind === 'edit' ? normalizeFsPath(value.trim()) : value.trim()
        return redactSecrets(cleaned)
      }
    }
  }
  const raw = (event.detail ?? '').trim()
  if (!raw) return ''
  return redactSecrets(kind === 'read' || kind === 'edit' ? normalizeFsPath(raw) : raw)
}

/** Unwraps an outer `pwsh`/`powershell`/`bash` `-Command`/`-c` invocation when a quoted command string follows. */
function unwrapShellWrapper(command: string): string {
  const pwsh = /^(?:"[^"]*(?:pwsh|powershell)(?:\.exe)?"|(?:pwsh|powershell)(?:\.exe)?)\s+(?:-(?:NoProfile|NonInteractive|NoLogo|ExecutionPolicy\s+\S+)\s+)*-(?:Command|c)\s+([\s\S]+)$/i.exec(command)
  const posix = /^(?:\/(?:usr\/)?bin\/)?(?:bash|sh|zsh)\s+-(?:l?c)\s+([\s\S]+)$/i.exec(command)
  const inner = (pwsh?.[1] ?? posix?.[1])?.trim()
  if (!inner) return command
  if (inner.length >= 2 && ((inner.startsWith('"') && inner.endsWith('"')) || (inner.startsWith('\'') && inner.endsWith('\'')))) {
    return inner.slice(1, -1).trim()
  }
  return inner
}

/** Splits a command into top-level statements on newlines or unquoted semicolons. */
function splitStatements(text: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: '"' | '\'' | null = null
  for (let index = 0; index < text.length; index++) {
    const ch = text[index]
    if (quote) {
      current += ch
      if (ch === quote && text[index - 1] !== '\\' && text[index - 1] !== '`') quote = null
      continue
    }
    if (ch === '"' || ch === '\'') {
      quote = ch
      current += ch
      continue
    }
    if (ch === ';' || ch === '\n' || ch === '\r') {
      const trimmed = current.trim()
      if (trimmed) parts.push(trimmed)
      current = ''
      continue
    }
    current += ch
  }
  const tail = current.trim()
  if (tail) parts.push(tail)
  return parts
}

const LEADING_BOILERPLATE: readonly RegExp[] = [
  /^(?:Push-Location|Set-Location|sl|cd)\s+\S+(?:\s+-LiteralPath\s+\S+)?$/i,
  /^(?:Push-Location|Set-Location|sl|cd)\s+(?:"[^"]*"|'[^']*')$/i,
  /^\$(?:ErrorActionPreference|ProgressPreference|InformationPreference|ConfirmPreference)\s*=\s*['"]?\w+['"]?$/i,
  /^Remove-Item\s+Env:\S+(?:\s+-ErrorAction\s+\S+)?$/i,
  /^Get-ChildItem\s+Env:\S+.*\|\s*Remove-Item\b/i,
  /^\[Console\]::OutputEncoding\s*=/i,
  /^chcp\s+\d+(?:\s*>.*)?$/i,
  /^set\s+-[euo]+(?:\s+-o\s+pipefail)?$/i,
  /^unset\s+[A-Z0-9_* ]+$/i
]

const TRAILING_BOILERPLATE = /^(?:Pop-Location|popd)$/i

function isLeadingBoilerplate(statement: string): boolean {
  return LEADING_BOILERPLATE.some(pattern => pattern.test(statement))
}

function stripAndAndPreamble(statement: string): string {
  const match = /^(?:cd\s+(?:"[^"]*"|'[^']*'|\S+)|set\s+-[euo]+(?:\s+-o\s+pipefail)?|unset\s+[A-Z0-9_* ]+)\s*&&\s*(.+)$/i.exec(statement)
  if (!match) return statement
  const rest = match[1].trim()
  return rest ? stripAndAndPreamble(rest) : statement
}

function truncateClean(text: string, limit: number): string {
  if (text.length <= limit) return text
  let end = limit - 1
  const code = text.charCodeAt(end - 1)
  if (code >= 0xd800 && code <= 0xdbff) end -= 1
  return `${text.slice(0, end).trimEnd()}…`
}

/**
 * Deterministic single-line summary for shell steps on the OxeChat timeline.
 * Simple commands (`pnpm test`, `npm run typecheck`) are preserved verbatim; noisy PowerShell/POSIX
 * setup boilerplate (`Push-Location ...; $ErrorActionPreference = 'Stop'; ...`) and multi-line noise
 * collapse into a crisp readable headline while the full raw command stays one click away.
 */
export function summarizeShellCommand(rawCommand: string, root: string): string {
  const redacted = relativizeCommandPaths(redactSecrets(rawCommand.trim()), root)
  if (!redacted) return ''
  const unwrapped = unwrapShellWrapper(redacted)
  const statements = splitStatements(unwrapped)
  if (statements.length === 0) return ''

  let start = 0
  while (start < statements.length - 1 && isLeadingBoilerplate(statements[start])) {
    start += 1
  }
  let end = statements.length
  while (end - start > 1 && TRAILING_BOILERPLATE.test(statements[end - 1])) {
    end -= 1
  }

  const kept = statements.slice(start, end)
  kept[0] = stripAndAndPreamble(kept[0])
  const collapsed = kept.join('; ').replace(/\s+/g, ' ').trim()
  const fallback = unwrapped.replace(/\s+/g, ' ').trim()
  return truncateClean(collapsed || fallback, SUMMARY_LIMIT)
}
